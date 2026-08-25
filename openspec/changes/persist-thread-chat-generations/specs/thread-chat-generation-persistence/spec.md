## Purpose

保证 thread-chat 的每次付费生成都有服务端可追踪身份和持久化终态，使页面刷新、断网或卸载不再丢失最终回复，并让明确停止、重试、计费与并发覆盖具有可验证的一致语义。

## ADDED Requirements

### Requirement: 分支树与生成任务按用户隔离

系统 SHALL 将分支树和 generation 绑定到已登录用户；树的读取、保存、列表、重命名、删除以及 generation 的创建、查询、停止均 SHALL 校验当前用户，且不得仅凭 treeId、generationId 或 URL 访问其他用户的数据。迁移前已存在且没有所有者的树 SHALL 只允许通过其原始精确 URL 被某一已登录用户一次性认领，认领后不得再次转移。

#### Scenario: 用户访问自己的树

- **WHEN** 已登录用户读取或修改归属于自己的分支树及其 generation
- **THEN** 系统 SHALL 正常处理请求，并只返回该用户的数据

#### Scenario: 用户访问其他人的树或 generation

- **WHEN** 已登录用户使用其他用户的 treeId 或 generationId 发起读取、修改、停止或删除请求
- **THEN** 系统 SHALL 拒绝请求且不泄露目标是否存在

#### Scenario: 历史无主树被认领

- **WHEN** 已登录用户通过迁移前保存的精确 `/thread-chat/{treeId}` URL 首次打开一棵无主树
- **THEN** 系统 SHALL 原子地把该树归属给当前用户，此后仅该用户可访问

### Requirement: 生成开始前必须建立持久化屏障

每次 thread-chat 生成 SHALL 使用唯一的应用 generation id，并绑定 tree、thread、触发它的 user message、目标 assistant message 和本次 attempt。系统 SHALL 在调用付费模型前确认包含用户消息与 assistant 占位的树状态已成功持久化，并在服务端成功创建 generation 记录；任一步失败时 SHALL NOT 调用模型。

#### Scenario: 持久化成功后开始生成

- **WHEN** 用户发送消息且树快照与 generation 记录均成功落库
- **THEN** 系统 SHALL 调用所选模型，并把该 generation 标记为当前 assistant 消息的运行中 attempt

#### Scenario: 提交前存盘失败

- **WHEN** 包含用户消息与 assistant 占位的树快照无法持久化
- **THEN** 系统 SHALL 不调用模型、不产生供应商费用，并把目标消息置为可重试错误

#### Scenario: 同一 generation 请求被重放

- **WHEN** 相同 generation id 的开始请求因网络重试被再次提交
- **THEN** 系统 SHALL 返回既有 generation 状态且不得启动第二次模型调用

### Requirement: 客户端断连不终止服务端生成

浏览器刷新、关闭标签页、页面卸载、路由切换或普通网络中断 SHALL 只断开客户端对流的消费，不得向模型传播中止信号。只要服务端执行环境仍有效，系统 SHALL 独立消费完整响应流，并继续完成生成、计费与终态持久化。

#### Scenario: 流式输出中刷新页面

- **WHEN** 用户在 assistant 回复尚未完成时刷新页面
- **THEN** 服务端 SHALL 继续消费该 generation，正常完成后保存最终回复并且只计费一次

#### Scenario: 页面卸载不等于停止

- **WHEN** thread-chat 组件因导航或关闭页面而卸载
- **THEN** 系统 SHALL NOT 因客户端清理本地请求而把 generation 标记为 stopped 或中止模型

### Requirement: 所有生成终态均持久化

系统 SHALL 为当前 generation 持久化结构化 assistant 结果，而非只保存纯文本。结果 SHALL 覆盖正文、Markdown Artifact、联网搜索/深读活动与来源、研究路由、研究计划、错误信息和可用的用量元数据；正常完成、明确停止与生成失败 SHALL 分别收敛为 completed、stopped 与 failed 终态。结果合并到树时 SHALL 保留用户后来建立的 forks 等非 generation 所有字段。

#### Scenario: 正常完成后保存完整结构化回复

- **WHEN** generation 正常输出正文、Markdown Artifact 或联网研究结果并结束
- **THEN** 系统 SHALL 保存完整结构化结果并把目标 assistant 消息恢复为 done

#### Scenario: 生成失败但已有部分输出

- **WHEN** generation 在产生部分正文或 Artifact 后发生模型、工具或流错误
- **THEN** 系统 SHALL 保留已有输出，把消息标记为 error，并提供可重试错误信息

#### Scenario: 正常结束但没有可展示输出

- **WHEN** generation 正常结束但没有正文、Artifact 或其他可展示结果
- **THEN** 系统 SHALL 把消息标记为可重试错误，不得持久化为空的成功回复

### Requirement: 刷新后恢复后台状态与最终答案

加载分支树时，系统 SHALL 以每条 assistant 消息的当前 generation attempt 为权威，将其终态结果覆盖浏览器可能保存的 pending、partial 或陈旧 attempt 快照。当前 generation 仍在运行时，页面 SHALL 保留该消息的忙碌态并轮询服务端状态；达到终态后 SHALL 自动展示完整结果并停止轮询。本阶段不要求恢复 token 级实时增量。

#### Scenario: generation 已在刷新期间完成

- **WHEN** 用户刷新时 generation 尚未完成，但重新加载树时该 generation 已为 completed
- **THEN** 页面 SHALL 直接显示服务端保存的完整最终回复，不显示旧的半截回复或空占位

#### Scenario: generation 仍在后台运行

- **WHEN** 页面加载时当前 generation 状态仍为 running 或 stop_requested
- **THEN** 页面 SHALL 显示后台生成中的忙碌态、阻止同一 thread 再次发送，并轮询直至获得终态

#### Scenario: 完成后长时间再访问

- **WHEN** generation 完成数分钟或更久后用户再次访问同一树
- **THEN** 系统 SHALL 从持久化数据恢复最终回复，不依赖原浏览器内存、原 SSE 连接或 sessionStorage

### Requirement: 只有明确操作才能停止或替换生成

系统 SHALL 提供经过鉴权的显式 Stop 操作。Stop 请求成功记录后 SHALL 中止对应服务端模型 generation，保存停止前已产生的部分结果并收敛为 stopped；本地界面不得在服务端确认前假装已经停止。Retry SHALL 被视为用户明确替换：旧 attempt 被停止或标记 superseded，新 attempt 使用新的 generation id。

#### Scenario: 用户明确停止

- **WHEN** 用户点击 Stop 且服务端接受该 generation 的停止请求
- **THEN** 系统 SHALL 中止模型、保存已有部分输出、把消息收敛为 stopped/done 或 stopped/error 的可展示终态，并停止继续产生该 generation 的输出

#### Scenario: Stop 与自然完成竞态

- **WHEN** Stop 请求与 generation 自然完成几乎同时发生
- **THEN** 系统 SHALL 通过原子状态转换只保留一个终态；已先完成的 generation 不得被事后改写成 stopped

#### Scenario: 用户重试同一 assistant 消息

- **WHEN** 用户对运行中或失败的 assistant 消息执行 Retry
- **THEN** 系统 SHALL 创建新的 generation attempt，并保证旧 attempt 后到的结果不能覆盖新 attempt

### Requirement: 当前 attempt 与终态合并必须防止旧写覆盖

对于同一 tree、thread 和 assistant message，系统 SHALL 明确记录唯一的当前 generation attempt。树加载、状态轮询、结果合并和计费关联 SHALL 只采用该当前 attempt；旧 attempt 即使稍后完成也不得覆盖当前回复。运行中的 generation 存在时，系统 SHALL 阻止会破坏其持久化目标的树删除操作。

#### Scenario: 旧 attempt 晚于新 attempt 完成

- **WHEN** 被 Retry 替换的旧 attempt 在新 attempt 启动后才返回终态
- **THEN** 系统 SHALL 保留旧 attempt 的审计/计费记录，但不得把其结果合并到当前 assistant 消息

#### Scenario: 运行中删除树

- **WHEN** 用户尝试删除仍有 running 或 stop_requested generation 的树
- **THEN** 系统 SHALL 阻止删除并要求先明确停止，避免模型继续运行但持久化目标被删除

### Requirement: generation 计费必须幂等

每个可计费 generation attempt SHALL 拥有稳定的应用级计费幂等键。客户端断连、完成回调重入、请求重放或状态轮询不得造成重复扣费；正常完成的 generation SHALL 继续按完整用量结算。明确停止时，系统 SHALL 记录可获得的已消耗用量；若供应商未返回被中止步骤的最终 usage，系统不得把“usage 不可得”伪装成已确认的零消耗。

#### Scenario: 完成回调被重复执行

- **WHEN** 同一 generation 的完成/持久化逻辑被执行多次
- **THEN** 系统 SHALL 最多产生一条对应的用量流水和一次余额扣减

#### Scenario: 断连后后台完成计费

- **WHEN** 客户端断连但 generation 在服务端正常完成
- **THEN** 系统 SHALL 使用完整 generation 用量结算一次，结果与客户端保持连接时一致

#### Scenario: 中止步骤没有最终 usage

- **WHEN** generation 被明确停止且供应商没有返回当前被中止步骤的最终 usage
- **THEN** 系统 SHALL 将该部分标记为用量不可得或待对账，不得写成已确认的零 token 成功账单

### Requirement: 陈旧运行记录不得永久转圈

系统 SHALL 为 running generation 维护可判定存活性的时间信息。若服务端执行超过约定租约且没有继续心跳或终态，后续加载/轮询 SHALL 将其收敛为 failed，并明确告知用户该次后台生成未能可靠完成；P0 不得声称可以在进程崩溃后恢复原模型执行。

#### Scenario: 服务进程在生成中被终止

- **WHEN** generation 长时间没有心跳且超过最大执行时长与宽限期
- **THEN** 系统 SHALL 把它标记为 failed、停止页面轮询并显示可重试错误，不得无限显示“正在生成”
