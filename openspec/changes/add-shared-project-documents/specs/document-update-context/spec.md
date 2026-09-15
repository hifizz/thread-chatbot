## ADDED Requirements

### Requirement: 项目文档与历史产物阅读入口区分

项目文档视图 SHALL 按 Document 展示一份持续文件，默认读取当前版本；历史 Message Artifact、Quote 与 Fork 来源 SHALL 固定历史内容。用户可通过文档标题旁的版本 Dropdown 显式切换查看最新版、历史版本和差异；历史版本展示“正在查看历史版本”与“查看最新版本”，切换只改变阅读内容，不执行回滚。活动选区或问题草稿 MUST NOT 因后台 head 更新被自动重新绑定。

#### Scenario: 最新版到达时正在划选
- **WHEN** 用户正在 R1 划选并输入问题，此时 R2 提交
- **THEN** 当前选区仍绑定 R1 Artifact，显示可查看新版本的提示，不能将旧 Anchor 套到 R2

#### Scenario: 查看差异
- **WHEN** 用户选择 R1 与 R2 的差异
- **THEN** 由固定版本内容计算只读差异，展示来源和修改说明，不触发写入

### Requirement: 文档各版本分叉遵守实际来源

文档版本中的划选 SHALL 使用该版本实际 Artifact ID，并沿用 #143 的来源 Message、父 Thread、Anchor 和 Quote 合同。Document 创建者所在 Thread 不替代具体版本的来源。普通新 Fork 的 completed 和有效时间线规则保持不变。

#### Scenario: 在分支更新后的版本划选
- **WHEN** R2 的 Artifact 由 Thread A 的 Message 产生，用户在 R2 划选开分支
- **THEN** 新分支挂在 A 下并固定 R2 Artifact，而不是因为 D1 起源于主线就挂回主线

#### Scenario: 更新已提交但回复未完成
- **WHEN** R2 已提交，而来源 Message 仍在生成或最终停止/失败
- **THEN** 文档可以读取和继续更新；新建分支入口按 #143 的 completed 要求明确不可用，不伪造消息完成状态

#### Scenario: 删除引用块
- **WHEN** 用户删除版本选区的 Quote
- **THEN** 不从 Document、Revision 或 Thread Anchor 恢复隐藏引用，正常历史与用户显式读取保持

### Requirement: 所有 Thread 自动接收后台更新摘要

系统 SHALL 在同 Project 任意 Thread 接受新用户消息（普通发送、编辑后的新消息、分叉 firstTurn）时，以单一 SQL 快照查询该 Thread 尚未通知的文档变化，并保存服务端生成的 `data-document-update-notices` Part。系统 MUST NOT 展示“主线待接收更新”、勾选范围、“恢复默认”或可见系统通知分隔线。用户只需继续对话，无需操作接收按钮。读取/更新工具的实际状态及版本历史保持可见。

通知 SHALL 固定 schemaVersion、Document/Revision/Artifact ID、当前版本号、标题、修改说明及来源 Thread/Message。每文档保留最近 10 条未通知提交摘要和 omittedChangeCount；这是变更线索，不是完整事件回放或全文。通知不得包含自动读取的正文，不得把“已通知”宣称成“已阅读全文”。

#### Scenario: 分支修改后主线继续
- **WHEN** Thread A 提交 R2，用户回主线发“接下来做什么”
- **THEN** 后台自动提供 R2 的固定摘要，用户无须点击接收；相关内容需要全文时模型调用 readProjectDocument 读取最新版

#### Scenario: 兄弟 Thread 继续对话
- **WHEN** Thread B 发送新消息，A 更新了文档
- **THEN** B 按自己的通知记录接收摘要，不带入 A 的整段讨论或所有文档全文

#### Scenario: 一次发生大量修改
- **WHEN** 同文档积累超过 10 次未通知修改
- **THEN** 通知保留当前版本、最近 10 条摘要和明确的省略数量；模型不能假设摘要完整，更不能靠摘要链推导最终正文

### Requirement: 通知收据按 Thread 独立记录

通知 Part 只表示计划输入。系统 SHALL 在提供商返回首个有效内容或工具响应后，在既有 assistant Message 的 document_context_used 保存固定通知收据。位置按 Thread 和 Document 的已通知 revisionNumber 计算，不新增全项目已读标志。仅初始化、预算失败或提供商拒绝不得推进。读取全文沿用独立的固定 read 工具结果和 readId。

#### Scenario: 主线已经收到但分支没有
- **WHEN** 主线收到 R2 的有效响应，B 尚未收到
- **THEN** 主线收据不消费 B 的更新；B 下一条新消息仍收到摘要

#### Scenario: 请求失败
- **WHEN** 新消息保存后预算失败或提供商仅返回错误
- **THEN** 不记录已通知，下一条新消息仍可提示变化；原消息 Part 保留，重试仍使用原通知

### Requirement: 新通知与读取结果仅追加在历史末尾

编译器 SHALL 在通知 Part 原有位置确定性地序列化固定摘要，不查询可变 head 或自动展开全文。所有新格式历史通知及固定工具读取结果 SHALL 保留原顺序和内容，不因新增版本、通知收据或后续轮次而删除/替换。重试/重生复用原用户消息的通知；新的显式工具读取可以获得更晚的版本并独立留痕。MUST NOT 将旧 @artifact 改成当前版本或修改 forkContext。

#### Scenario: 接受消息后文档继续更新
- **WHEN** 本轮通知固定 R2，之后提交 R3
- **THEN** 原通知仍是 R2；本轮显式读取可读 R3 并保存固定结果，下一条新消息按收据查询尚未通知的变化

#### Scenario: 第四轮和第七轮读取不同版本
- **WHEN** 第四轮读取 R2，第七轮通知 R3 后读取 R3
- **THEN** 第四轮全文保持原样，第七轮追加新通知/读取结果；不为省 token 删除历史正文，不承诺提供商一定命中缓存

#### Scenario: 通知后再次引用同一 Artifact
- **WHEN** 前文只有某版本的更新摘要，后文显式引用该版本
- **THEN** 不把摘要算作已包含全文，实际引用仍正常展开固定正文

### Requirement: 按需读取与统一上下文预算

工具指令 SHALL 要求模型在回答已变化文档的具体内容或准备修改时读取完整最新版（不指定 revisionId）；无关变化可以不读取。通知本身不是写入授权。系统 SHALL 将摘要、历史、实际读取结果计入现有最终请求预算；已知超限明确失败，unknown 保留真实含义及提供商错误，不静默截断/压缩/删除历史，也不提供已移除的勾选范围作为恢复方式。长对话压缩不属于本次改动。

#### Scenario: 十份文档均有变化
- **WHEN** 项目十份文档都更新，而本轮只讨论 D1
- **THEN** 后台提供十份简短通知，模型按需读取 D1，不自动加载十份全文

#### Scenario: 每轮相关文档都被修改
- **WHEN** 每轮开始前其他 Thread 都更新了相关文档
- **THEN** 每轮追加新摘要，必要时追加最新版读取；持续增长仍受预算约束，不假称缓存能减少上下文长度

### Requirement: 组件与工具状态以权威 DTO 为准

界面 SHALL 复用 #143 的阅读、划选、来源导航及现有组件，分离文档列表、版本阅读、历史/差异、工具状态和文档目录同步。组件不得自行 patch 正文或决定数据库写入资格。提交成功、冲突处理、未提交失败和已满足状态必须清楚区分，手机版复用现有 Drawer 与焦点规则。

#### Scenario: 显示提交结果
- **WHEN** 服务端返回 committed
- **THEN** 展示本次 Revision、修改说明、差异入口与来源；不是直接把本地预览当作保存后的正文

#### Scenario: 停止后的已提交操作
- **WHEN** 工具已提交但整条回复被停止
- **THEN** 卡片仍显示已提交的版本事实，不能显示为未修改或自动恢复旧版

#### Scenario: 桌面与手机查看同一历史
- **WHEN** 用户切换设备打开 R2
- **THEN** 使用同一固定 DTO 内容与来源，布局变化不改变引用语义或提交状态

### Requirement: 旧格式上下文保持兼容

旧 `data-project-document-updates` SHALL 保留原固定全文展开及旧失败计划过滤规则，旧 commitIds 收据继续识别；新消息不再生成旧格式。新版摘要不应用旧失败计划的历史过滤。前端对两类服务端 Part 均不展示，恢复编辑内容时均忽略，不将其当用户输入或伪造 Quote。

#### Scenario: 打开旧项目继续聊
- **WHEN** 历史含旧固定清单和实际使用收据
- **THEN** 旧模型输入按原规则重放，新消息追加新版摘要；不迁移、删除或重新解释历史记录

### Requirement: 导出与系统文件分享固定所选版本

导出和系统文件分享 SHALL 使用用户所选 Revision 的固定 Markdown，不能动态追随 head。不支持系统文件分享时 SHALL 提示导出，不创建浮动版本链接。

#### Scenario: 导出历史版本
- **WHEN** 用户阅读 V1 并导出或系统分享，而文档 head 为 V3
- **THEN** 文件仅包含 V1 固定正文，不改变 V3

### Requirement: 当前文档目录与固定历史引用分离

新建引用候选、项目文档列表及文档数量 SHALL 使用统一的当前文档目录，每个 Document 只展示当前内容。消费者 MUST NOT 分别实现版本排序或按标题合并。按 Document ID 读取且未指定历史版本时 SHALL 返回当前内容；历史引用仍按固定 Artifact ID 读取。已知当前正文尚未载入时 MUST NOT 将旧内容冒充当前内容；来源资格检查不得导致回退到旧版。

#### Scenario: 一份文档更新三次后的新引用
- **WHEN** 项目包含同一 Document 的多个固定版本
- **THEN** 新建 @ 引用仅出现一份文档，选择后引用当前固定内容，旧消息中的引用仍保留原文

#### Scenario: 两份独立文档同名
- **WHEN** 两个不同 Document 使用相同标题
- **THEN** 目录仍保留两份独立文档，不以标题去重
