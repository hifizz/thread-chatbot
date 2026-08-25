## MODIFIED Requirements

### Requirement: 使用统一的核心术语
系统 MUST 使用以下术语表达目标模型：

- **Project**：一整项可持续工作的内容聚合边界，直接归属于当前用户，拥有一个 Root Thread、全部后代 Thread，以及这些 Thread 共享的 Memory、Instruction、Target、Files 和 Artifacts。当前 UI 的一个“对话列表项”对应一个 Project。
- **Thread**：Project 中一列可独立继续的线性对话。Root Thread 与 Branch Thread 只是关系角色，不是不同实体类型。
- **Fork**：从已有 Thread 的确定 Message 创建 Child Thread 的原子操作。
- **Message**：Thread 中具有稳定 ID、角色、内容和服务端 sequence 的消息实体。
- **MessageRun**：仅为 assistant Message 持久化的后台生成记录；它属于运行基础设施，不是可独立导航的聊天内容实体。
- **BaseContext**：Fork 时由服务端冻结的有序 Message ID 列表，表示 Child Thread 继承的有效 Prompt 历史。
- **ForkSourceSnapshot**：Fork 时冻结的来源定位与引用展示信息。
- **Project Resource**：在同一 Project 的全部 Thread 间共享、但不跨 Project 自动共享的 Memory、Instruction、Target、File 或 Artifact。
- **Target**：Project 希望实现的目标集合，用于表达该 Project 的终极目标，以及为实现终极目标而设定的短期目标和中期目标。Target 属于 Project 级共享信息，不表示某个 Thread 的临时任务，也不等同于单条用户消息中的请求。
- **Artifact**：归属于 Project，并保留来源 Message 身份的持久化产物。
- **Title**：Project 或 Branch Thread 的短标题。

系统 MUST 将当前 Thread Tree 的聚合职责迁移到 Project，并将当前嵌在 `ThreadTreeState` 中的 Thread、Message 和 Artifact 迁移为可独立寻址的实体。目标规范、数据库、API 和客户端实体模型 MUST 使用 Project 表达整簇 Thread 的聚合边界，且 MUST NOT 继续把 Thread Tree、MainThread、ForkedThread、独立 ThreadFork、Turn、Generation 或 Message Variant 作为目标领域实体。

#### Scenario: 将一簇分叉对话称为 Project
- **WHEN** 用户查看由一个 Root Thread 和多列 Branch Thread 组成的工作项
- **THEN** 系统 MUST 将整体领域实体称为 Project，并将每一列称为 Thread

#### Scenario: 从关系推导 Thread 角色
- **WHEN** 一个 Thread 没有 Parent Thread
- **THEN** 系统 MUST 将其视为 Root Thread
- **AND** 当一个 Thread 具有 Parent Thread 时，系统 MUST 将其视为 Branch Thread

#### Scenario: 描述非根线程
- **WHEN** 产品或代码需要描述由 Fork 创建的非根对话列
- **THEN** 系统 MUST 将该节点称为 Child Thread 或按相对角色称为 Branch Thread
- **AND** 必须使用 Fork 描述创建动作，不得把 ForkedThread 作为独立实体类型

#### Scenario: 从当前 Thread Tree 建立 Project
- **WHEN** 系统迁移一条现有 `branch_trees` 记录
- **THEN** 它 MUST 建立一个对应 Project，并把该记录中的 Thread、Message 和 Artifact 映射到该 Project 下的规范化实体
- **AND** 不得把现有整树 JSON 误写成已经规范化的 Project 数据

### Requirement: 维护 Project 的 Thread 拓扑不变量
系统 MUST 使用 Project 与 Thread 关系维护分叉拓扑：

- 每个 Project MUST 归属于且仅归属于一个用户；其他访问关系不属于本 change。
- 每个 Project MUST 有且仅有一个没有 Parent Thread 的 Root Thread。
- 每个 Thread MUST 归属于且仅归属于一个 Project。
- 每个非 Root Thread MUST 具有同一 Project 内的 Parent Thread、确定的来源 Message、ForkSourceSnapshot 和 BaseContext。
- Child Thread MUST 可以继续产生自己的 Child Thread，形成任意深度的有向无环层级。
- 系统 MUST 阻止跨 Project 的 Parent Thread、来源 Message 或 Fork 关系，并阻止形成环。
- Fork MUST 由服务端原子创建 Child Thread 及全部来源事实；客户端不得构造 Child Thread 新 ID 或 BaseContext。

#### Scenario: 创建 Project 根 Thread
- **WHEN** 系统创建一个新 Project
- **THEN** 系统 MUST 在同一事务建立该 Project 唯一的 Root Thread
- **AND** Root Thread MUST 不包含 Parent Thread 或 Fork 来源

#### Scenario: 创建嵌套分叉
- **WHEN** 用户从 Branch Thread 的一条合格 Message 再次 Fork
- **THEN** 系统 MUST 在同一 Project 中创建新的 Child Thread
- **AND** 新 Thread MUST 指向该 Branch Thread 与确定来源 Message

#### Scenario: 拒绝跨 Project Fork
- **WHEN** Fork 来源 Thread 或来源 Message 不属于目标 Project
- **THEN** 系统 MUST 拒绝请求且不创建任何部分数据

#### Scenario: 拒绝 Fork 与拓扑矛盾的状态
- **WHEN** 非 Root Thread 缺少 Parent Thread、来源 Message、ForkSourceSnapshot 或 BaseContext，或者关系会形成环
- **THEN** 系统 MUST 拒绝该 Project 状态

#### Scenario: Fork 原子失败
- **WHEN** ForkSourceSnapshot、BaseContext 或 Child Thread 中任一项无法持久化
- **THEN** 系统 MUST 回滚整个 Fork 操作

### Requirement: 明确标题的归属与优先级
系统 MUST 区分 Project 标题与 Branch Thread 标题：

1. Project 标题描述整项工作，同时作为 Project 列表项和 Root Thread 列头的展示标题。
2. Branch Thread 标题描述局部主题，仅覆盖对应列的标题展示。
3. 用户账户展示名称不得替代 Project 或 Thread 标题。

#### Scenario: 展示 Root Thread 标题
- **WHEN** 客户端展示 Project 的 Root Thread
- **THEN** 客户端 MUST 使用 Project 标题作为该列标题

#### Scenario: 主线自动标题与用户重命名并存
- **WHEN** Project 已生成自动标题，且用户随后设置自定义 Project 标题
- **THEN** Project 列表和 Root Thread 列头 MUST 展示自定义标题
- **AND** 系统 MUST 保留自动标题作为机器派生信息

#### Scenario: 展示 Branch Thread 标题
- **WHEN** 客户端展示具有局部标题的 Branch Thread
- **THEN** 客户端 MUST 使用该 Thread 标题
- **AND** 不得因此修改 Project 标题

## ADDED Requirements

### Requirement: 使用 Project 作为对话列表与共享资源边界
“新对话”操作 MUST 创建新的 Project 与唯一 Root Thread；“对话列表” MUST 列出当前用户拥有或可访问的 Project。

Project 的 Memory、Instruction、Target、Files 和 Artifacts MUST 可供该 Project 的全部 Thread 使用，并 MUST NOT 仅因多个 Project 属于同一用户而自动跨 Project 共享。

#### Scenario: 创建新对话
- **WHEN** 用户点击“新对话”
- **THEN** 系统 MUST 创建新的 Project 与唯一 Root Thread
- **AND** 导航到以服务端 Project ID 标识的 ThreadChat 页面

#### Scenario: 展示对话列表
- **WHEN** 用户打开“对话列表”
- **THEN** 系统 MUST 展示当前用户拥有或可访问的 Projects

#### Scenario: Thread 使用 Project 资源
- **WHEN** Project 中任一 Thread 构建允许使用 Project 上下文的请求
- **THEN** 系统 MUST 允许它引用该 Project 的 Memory、Instruction、Target、Files 和 Artifacts

#### Scenario: Project 资源隔离
- **WHEN** 另一个 Project 的 Thread 未获得显式授权
- **THEN** 系统 MUST NOT 自动向它提供当前 Project 的共享资源

### Requirement: 维护 Thread 的线性消息顺序
系统 MUST 将每个 Thread 内的 Message 保存为严格线性的追加序列。服务端 MUST 为新 Message 分配在该 Thread 内单调递增且唯一的 `sequence`；客户端 MUST 使用 `sequence` 而不是客户端时间、角色交替或前后消息指针恢复稳定顺序。

系统 MUST 允许连续多条 user Message，且 MUST NOT 将 `user → assistant` 一一配对作为数据库不变量。“只允许编辑当前最后一条有效 user Message”是 MVP 应用策略，不代表 user Message 必须拥有配对的 assistant Message。

#### Scenario: 连续发送多条 user Message
- **WHEN** 用户在 assistant 尚未产生最终回复前又发送一条 user Message
- **THEN** 系统 MUST 将两条 user Message 保存为同一 Thread 内具有不同 sequence 的独立 Message
- **AND** 不得仅因角色没有交替而拒绝或重排它们

#### Scenario: 按服务端顺序读取消息
- **WHEN** 客户端读取一个 Thread 的消息
- **THEN** 系统 MUST 按 sequence 升序返回有效时间线
- **AND** 相同 Thread 内不得存在重复 sequence

### Requirement: 使用不可变 Message replacement
Message 内容在创建完成或 finalized 后 MUST NOT 原地改写。Edit 和 Regenerate MUST 创建具有新 ID 与新 sequence 的 replacement Message，通过 `replacesMessageId` 指向旧 Message，并将旧 Message 标记为 `superseded`。

默认时间线 MUST 隐藏 superseded Message，但持久化层 MUST 保留其 ID、sequence、内容和来源关系。MVP MUST NOT 提供 Message Variant，也 MUST NOT hard delete 单条 Message；只有永久删除整个 Project 时，系统才 MUST 统一清理 Project 下的 Thread、Message、MessageRun 和附属资源。

#### Scenario: Regenerate assistant 回复
- **WHEN** 用户对当前可重新生成的 assistant Message 执行 Regenerate
- **THEN** 系统 MUST 创建新的 assistant Message 与新的 MessageRun
- **AND** 旧 assistant Message MUST 被标记为 superseded，但其 ID、sequence 和内容 MUST 保持不变

#### Scenario: 编辑最后一条 user Message
- **WHEN** 用户编辑当前 Thread 最后一条有效 user Message
- **THEN** 系统 MUST 创建 replacement user Message
- **AND** 原 Message 及所有 sequence 更大、依赖原内容的有效 Message MUST 退出默认时间线但继续保留
- **AND** replacement user Message 及后续新回复 MUST 以新 sequence 追加到 Thread 尾部

#### Scenario: 拒绝编辑历史 user Message
- **WHEN** 用户尝试编辑并非当前 Thread 最后一条有效 user Message 的消息
- **THEN** 系统 MUST 按 MVP 策略拒绝操作，并提示使用 Fork 保留另一条历史

#### Scenario: 永久删除 Project
- **WHEN** 已获授权的用户确认永久删除整个 Project
- **THEN** 系统 MUST 将该 Project 的共享资源、Thread、Message 和 MessageRun 作为完整边界清理

### Requirement: 冻结 Fork 的消息身份上下文
Fork 时，服务端 MUST 根据来源 Thread 在 Fork 点之前的有效 Prompt 历史生成不可变 BaseContext。BaseContext MUST 包含 schema 版本和按 Prompt 顺序排列的 `messageIds`，不得复制 Message Parts，也不得由客户端提交或重建。

进入 BaseContext 或作为 Fork source 的 Message MUST 已 finalized 且具备 Prompt 资格。有效 user Message 可以进入；仅 completed assistant Message 可以进入并作为来源；queued、running、failed 或 stopped assistant Message 不得进入，也不得作为 Fork source。Parent 后续发生 replacement、追加或归档时，既有 Child Thread 的 BaseContext MUST 保持不变。

#### Scenario: 从 completed assistant Message Fork
- **WHEN** 用户从 finalized 且 completed 的有效 assistant Message 发起 Fork
- **THEN** 服务端 MUST 在同一 Project 创建 Child Thread
- **AND** BaseContext MUST 冻结到来源 Message 为止的有序有效 Message ID

#### Scenario: 生成期间不允许 Fork
- **WHEN** 当前 Thread 最后一条 assistant Message 的 MessageRun 处于 queued 或 running
- **THEN** 客户端 MUST 隐藏或禁用 Fork
- **AND** 服务端 MUST 拒绝绕过客户端发起的 Fork 请求

#### Scenario: Parent Message 后续被 replacement
- **WHEN** Child Thread 的 BaseContext 引用了之后被 superseded 的 Parent Message
- **THEN** Child Thread MUST 继续按原 Message ID 解析冻结历史
- **AND** replacement Message MUST NOT 自动替换 BaseContext 中的 ID

#### Scenario: 客户端试图提交 BaseContext
- **WHEN** Fork 请求包含客户端构造的 BaseContext 或待创建 Child Thread ID
- **THEN** 服务端 MUST 忽略或拒绝这些字段，并只使用服务端计算和生成的值

### Requirement: 持久化 assistant MessageRun
每条 assistant Message MUST 具有且仅具有一条持久化 MessageRun，user Message MUST NOT 具有 MessageRun。MessageRun MUST 至少表达 queued、running、completed、failed 和 stopped 状态，并保存恢复流式展示所需的运行进度。

浏览器刷新、关闭或流连接断开 MUST 只终止该客户端订阅，不得自动停止后台 MessageRun。客户端重新加载 Thread 时，系统 MUST 通过 assistant Message 及其 MessageRun 恢复最终内容、生成中、失败或停止状态。

#### Scenario: 创建 assistant Message
- **WHEN** 服务端接受一次需要 AI 回复的生成命令
- **THEN** 服务端 MUST 在同一原子边界创建 assistant Message 与唯一 MessageRun

#### Scenario: 刷新后恢复运行状态
- **WHEN** assistant Message 的 MessageRun 仍为 queued 或 running 且用户刷新页面
- **THEN** 客户端 MUST 加载该状态并恢复生成展示与事件订阅
- **AND** 刷新不得创建第二条 MessageRun

#### Scenario: 队列启动失败
- **WHEN** MessageRun 在进入 running 前无法启动
- **THEN** 系统 MUST 允许它从 queued 转为 failed

### Requirement: 维护 Project 共享的 Artifact
Artifact MUST 归属于且仅归属于一个 Project，并 MUST 保留产生它的来源 Message 身份。该 Project 的全部 Thread MUST 能按权限引用 Artifact；其他 Project MUST NOT 仅因归属于同一用户而自动获得访问权。

BaseContext MUST 通过 Message ID 间接保留 Artifact 的来源语义，不得复制大型 Artifact 内容。MVP MUST NOT 因本重构引入 ArtifactVersion、通用资源图或内容寻址存储。

#### Scenario: 同 Project 的 Thread 使用 Artifact
- **WHEN** Project 中一个 Thread 的 Message 产生 Markdown Artifact
- **THEN** 同 Project 的其他 Thread MUST 能按权限引用该 Artifact
- **AND** 系统 MUST 保留 sourceMessageId 作为来源

#### Scenario: Fork 历史包含 Artifact
- **WHEN** BaseContext 引用的 Message 产生过 Artifact
- **THEN** 系统 MUST 能通过 Message ID 解析其 Project Artifact 关联
- **AND** BaseContext 不得复制 Artifact 正文

#### Scenario: 隔离其他 Project
- **WHEN** 另一个 Project 未获得显式授权
- **THEN** 系统 MUST NOT 向它暴露当前 Project 的 Artifact

## RENAMED Requirements

- FROM: `### Requirement: 维护线程树的层级不变量`
- TO: `### Requirement: 维护 Project 的 Thread 拓扑不变量`
