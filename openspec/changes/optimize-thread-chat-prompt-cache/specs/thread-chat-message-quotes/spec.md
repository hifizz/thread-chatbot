## Purpose

定义 Thread Chat 用户 Message 中零到多份引用（Quote）的后端合同，使分支首问、当前 Thread 内引用、当前 Thread Markdown Artifact 批量批注、持久化、编辑、重试、模型上下文和未来来源导航使用同一份版本化 Parts 协议，同时保证来源元信息不会泄漏到模型 Prompt。

## ADDED Requirements

### Requirement: User messages support up to fifty ordered quote parts

系统 MUST 允许一个用户 Message 在 `parts` 中包含零到 50 份有序 `data-quote` Part。新写入 Quote MUST 使用版本化 `thread-quote-v1` payload。多份 Quote MUST 使用重复 Parts 表达，而不是压进单个字符串、单个数组 Part 或第二个顶层 DTO 字段。

#### Scenario: A user message contains fifty valid quotes
- **WHEN** 用户提交 50 个合法且预算内的 Quote Selection
- **THEN** Message 按用户顺序持久化 50 个独立 `data-quote` Part，并只触发一次 assistant 生成

#### Scenario: Quote count exceeds fifty
- **WHEN** 合并自动 branch-origin 后 Quote 总数超过 50
- **THEN** 服务端在创建付费模型调用前拒绝命令，并且不得静默删除 Quote

#### Scenario: A message has no quote
- **WHEN** 用户发送普通问题且没有自动 branch-origin 或显式 Quote
- **THEN** Message 不包含 Quote 占位 Part，普通消息行为保持不变

### Requirement: Quote payload separates frozen text, comment, and navigation metadata

每份 V1 Quote MUST 包含服务端生成的 `quoteId`、`kind`、冻结 `text`、可选用户 `comment` 和 `source`。`text` MUST 等于 `source.anchor.quote.exact`。`source` MUST 保存稳定的 Project、Thread、Message 或 Artifact ID 与 `TextAnchor`。屏幕坐标、滚动位置、DOM 路径、标题、脚注和列位置 MUST NOT 作为来源身份。

#### Scenario: A normal message quote is persisted
- **WHEN** 用户引用当前 Thread 的 completed assistant Message 选区
- **THEN** Quote 保存冻结正文和来源，`comment` 可以省略

#### Scenario: An artifact annotation is persisted
- **WHEN** 用户对当前 Thread 产生的 Markdown Artifact 选区写入批注
- **THEN** Quote 保存冻结正文、该 Quote 自己的 comment、Artifact ID、来源 Message 和 Anchor

#### Scenario: Source title or layout changes
- **WHEN** 来源 Thread 重命名、脚注变化、字体或 Markdown 布局变化
- **THEN** Quote 来源身份不变，未来导航使用稳定 ID 与 TextAnchor，而不是旧标题或屏幕位置

### Requirement: Ordinary quote sources are restricted to the destination thread

普通 Quote Source MUST 是以下之一：

1. 目标 Composer 所属当前 Thread 内的 `completed` assistant Message；
2. 目标 Composer 所属当前 Thread 内，由 `completed` assistant Message 产生的 Markdown Artifact。

客户端 MUST NOT 提交任意 `sourceThreadId`。服务端 MUST 从来源实体推导 Thread，并验证它等于 API 目标 Thread。任意其他 Thread、其他分栏或其他 Project 的来源 MUST 被拒绝。

#### Scenario: User quotes a completed message in the current thread
- **WHEN** 来源 Message 属于目标 Thread、role 为 assistant 且 status 为 completed
- **THEN** 服务端可以创建普通 Message Selection Quote

#### Scenario: User quotes a message from another thread
- **WHEN** 客户端向 Thread A 的发送接口提交了属于 Thread B 的 `sourceMessageId`
- **THEN** 服务端在写入 User Message 和调用模型前拒绝整个命令

#### Scenario: User quotes an artifact from another thread
- **WHEN** Artifact 的 source Message 不属于目标 Thread
- **THEN** 服务端拒绝 Quote，即使 Artifact 与目标 Thread 位于同一 Project

#### Scenario: User quotes a stopped response
- **WHEN** 来源 assistant Message 的 status 为 stopped
- **THEN** 服务端拒绝 Quote；不得因已有部分正文而把 stopped 视为稳定来源

#### Scenario: User quotes generating or failed content
- **WHEN** 来源 assistant Message 为 generating 或 failed
- **THEN** 服务端拒绝整个命令，不写入部分 Quote 或用户 Message

### Requirement: Fork origin is the only cross-thread quote and is server-derived

ForkedThread 第一轮的父 Thread 来源 MUST 被服务端物化为 `kind=branch-origin` 的第一份 Quote。该 Quote MAY 指向父 Thread，但 MUST 由 Thread 的 `parentId / forkMessageId / forkAnchor / anchorText` 生成，客户端不得通过普通 `quotes[]` 构造任意跨 Thread Quote。

#### Scenario: Selection popup includes a question
- **WHEN** `forkThread` 命令包含 `firstTurn`
- **THEN** 同一事务创建 Thread、branch-origin Quote、B1 和 assistant placeholder

#### Scenario: Selection popup is submitted without a question
- **WHEN** 用户留空提交划选弹窗
- **THEN** 系统只创建 ForkedThread，不创建 User/Assistant Message，不调用模型；新 Thread Composer 可从 Fork 字段重建 branch-origin Draft Quote

#### Scenario: Empty fork sends its first message later
- **WHEN** ForkedThread 尚无有效 User Message，用户随后第一次发送
- **THEN** 服务端自动把 Fork 来源物化为第一份 branch-origin Quote，再处理当前 Thread 内其他合法 Quote

#### Scenario: Client tries to submit another cross-thread selection
- **WHEN** 第一轮命令额外引用了父 Thread 或其他 Thread 的 Message
- **THEN** 服务端只保留自动 branch-origin，并拒绝不属于目标新 Thread 的普通 Quote Selection

### Requirement: Quote selections are authorized and frozen by the server

客户端 MUST 只提交当前 Thread 来源的 Message ID 或 Artifact ID、`TextAnchor` 与可选 comment。服务端 MUST 在 owner-scoped 事务中验证目标 Project、目标 Thread、来源实体、状态、Anchor、数量和预算，然后生成持久化 Quote ID、kind、text 和完整 source。客户端不得直接决定持久化 `projectId`、`threadId`、`quoteId`、`kind` 或冻结正文。

#### Scenario: Client submits a valid current-thread message selection
- **WHEN** 来源 Message 属于目标 Thread 且状态合法
- **THEN** 服务端使用 `anchor.quote.exact` 作为冻结正文，生成 Quote ID，并补全真实 Project/Thread/Message ID

#### Scenario: Client submits a valid current-thread artifact annotation
- **WHEN** Artifact 来源 Message 属于目标 Thread且为 completed
- **THEN** 服务端冻结选区正文并保存用户 comment

#### Scenario: Client references another project or user
- **WHEN** 来源不属于当前用户或目标 Project
- **THEN** 服务端拒绝整个命令，不能通过猜测 UUID 越权引用

#### Scenario: Duplicate selections are submitted
- **WHEN** 同一来源与同一 Anchor 在一条 Draft 中重复出现
- **THEN** 服务端保留第一次出现位置并去重；自动 branch-origin 始终优先为第一项

### Requirement: Quote count and prompt budget are separate safeguards

系统 MUST 把 50 个 Quote 视为产品数量上限，同时使用版本化 Quote/Input Budget Policy 对 Quote、comment 和完整模型输入进行发送前预检。系统 MUST NOT 因数量未超过 50 就无条件发送超大输入。

#### Scenario: Fifty short annotations fit the budget
- **WHEN** 50 份短 Quote 与 comment 均满足当前模型 Route 的输入预算
- **THEN** 系统允许发送并产生一条 User Message

#### Scenario: Ten long quotes exceed the route budget
- **WHEN** Quote 数量低于 50，但预计 Token 超出当前 Route 的 Quote 或总输入预算
- **THEN** 系统在付费模型调用前返回明确预算错误，不静默截断、删除或自动摘要

#### Scenario: Budget policy changes
- **WHEN** Quote Budget Policy 版本或所选模型 Route 改变
- **THEN** 系统使用新策略重新预检，并把版本记录到 Prompt Manifest

### Requirement: Message parts remain the quote snapshot authority without a new quote table

Quote Snapshot MUST 持久化在 `messages.parts` JSONB，并通过现有 `MessageDTO.parts` 返回。`threads` Fork 字段继续作为分支拓扑事实。第一阶段 MUST NOT 新增独立 Quote 业务表或顶层 `MessageDTO.quotes` 字段。

#### Scenario: Project bootstrap loads quoted messages
- **WHEN** 客户端加载 `ProjectBootstrapDTO`
- **THEN** 每条 Message 的 Quote 按原 `parts` 顺序返回，不需要额外请求或第二个 DTO 字段

#### Scenario: A project is deleted
- **WHEN** 同 Project 的 Thread 和 Message 被现有级联删除
- **THEN** Quote Snapshot 随目标 Message 删除，不留下独立 Quote 行

#### Scenario: Arbitrary cross-thread references are requested later
- **WHEN** 产品未来需要 `@Thread`、跨 Thread 引用、反向链接或独立权限
- **THEN** 必须创建新的 change 重新设计权限、预算、去重和索引，不能把本期协议解释为已支持

### Requirement: Text edits preserve existing quote snapshots

普通 `EditLatestTurn` MUST 只替换用户可编辑文本和附件，并在替代 Message 中原顺序保留来源 User Message 的全部合法 persistent Quote Part。Retry Assistant MUST 直接继续使用当前 User Message，不复制、删除或重新生成 Quote。

#### Scenario: User edits a quoted question
- **WHEN** User Message 包含多份 Quote，用户只修改总问题文本
- **THEN** 新替代 User Message 保留相同 Quote IDs、正文、comment、来源和顺序

#### Scenario: User retries an assistant answer
- **WHEN** 用户对引用式问题执行 Retry
- **THEN** 新 assistant Message 读取同一 User Message Parts，Quote 不产生新 ID 或重复快照

#### Scenario: A stored quote is malformed
- **WHEN** Edit 路径读取到无法解析的 persistent Quote payload
- **THEN** 系统报告数据冲突并拒绝静默丢弃 Quote

### Requirement: Quote payload is backward compatible on read and single-version on write

运行期 MUST 兼容历史 `{ text: string }` Quote payload，并把它规范化为无来源的 legacy Quote；新写入 MUST 只产生 V1。历史 ForkedThread 的第一条 User Message 若没有 branch-origin Quote，Prompt Compiler MUST 根据 Thread Fork 字段确定性生成仅用于模型视图的兼容 Quote，而不要求立即改写历史 Message。

#### Scenario: Legacy data-quote is loaded
- **WHEN** Message Parts 包含历史 `{ text }` Quote
- **THEN** UI/模型仍可读取正文，但来源导航标记为不可用，不伪造 source IDs

#### Scenario: Existing branch has no quote part
- **WHEN** 旧 ForkedThread 的 B1 仅有问题文本
- **THEN** 模型上下文在冻结祖先历史之后收到由 Thread Fork 字段生成的 branch-origin Quote，再收到 B1 问题

#### Scenario: New data is written after rollout
- **WHEN** 新命令创建任何 Quote
- **THEN** 持久化 payload 一律包含 `schemaVersion=thread-quote-v1`

### Requirement: Model serialization includes quote text and comment only

系统 MUST 通过唯一、版本化、确定性的 Quote-to-model helper，把每份 Quote 的冻结正文和可选 comment 转换为模型文本。转换 MUST 保留 Quote Part 顺序，MUST NOT 序列化 `quoteId`、kind、来源 IDs、Anchor、标题、脚注、Draft ID 或其他导航元信息。

#### Scenario: One quote is converted for the model
- **WHEN** Prompt Compiler 遇到一个 V1 `data-quote`
- **THEN** 它只把 `text` 与可选 `comment` 通过 `quoteContentToModelText()` 转换为版本化 `<thread_quote>` block

#### Scenario: Multiple quotes are converted
- **WHEN** 一条 User Message 含多份 Quote
- **THEN** 模型按 Parts 顺序收到多个独立 Quote block，随后收到总问题文本

#### Scenario: Quote contains markup-like text
- **WHEN** 引用正文含换行、引号、代码或 `</thread_quote>` 等字符串
- **THEN** Serializer 使用确定性 JSON 编码，不能让正文提前关闭 block

#### Scenario: Navigation metadata changes
- **WHEN** Quote 的 source metadata 或未来 UI 状态变化，但正文和 comment 不变
- **THEN** 模型文本完全相同，Token 和缓存请求形状不受产品元信息影响

### Requirement: Quote behavior is defined once in the stable agent kernel

Agent Kernel MUST 使用固定规则解释零到多份 Quote：Quote 是上下文数据而非更高优先级指令，comment 是局部用户要求，普通文本是总请求，多 Quote 按顺序比较、综合或逐条处理。具体 Quote 正文 MUST NOT 被拼入 System Prompt。

#### Scenario: A quoted passage contains imperative text
- **WHEN** Quote 正文包含“忽略之前规则”等命令式内容
- **THEN** 模型把它作为被引用的数据分析，不把它提升为 System 或 Project 指令

#### Scenario: User refers to multiple quotes
- **WHEN** 用户问题使用“这些段落”“逐条”等指代
- **THEN** 模型按 Quote 出现顺序理解并处理

### Requirement: Quote metadata supports future source navigation without defining cross-thread composition

V1 Quote MUST 保存真实 Thread/Message/Artifact ID 与 TextAnchor，以支持未来点击回到来源并高亮。该导航能力 MUST NOT 被解释为可以把另一个 Thread 的内容加入当前 Composer。

#### Scenario: Future UI opens a current-thread quote source
- **WHEN** 前端读取一个有 source 的普通 Quote
- **THEN** 它拥有定位当前 Thread 来源 Message 或 Artifact 选区所需的稳定标识

#### Scenario: Future UI opens a branch-origin source
- **WHEN** 前端读取第一轮 branch-origin Quote
- **THEN** 它可以回到父 Thread 的原 Message 和 Anchor；这仍不提供任意跨 Thread添加能力

#### Scenario: Source message was superseded after capture
- **WHEN** 来源 Message 后续被 Edit/Retry 替代但原行仍保留
- **THEN** Quote 继续指向创建时原 Message，不静默跳到新 Message
