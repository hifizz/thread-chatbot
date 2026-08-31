## Purpose

定义 Thread Chat 用户 Message 中零到多份引用（Quote）的后端合同，使分支首问、普通消息引用、Markdown Artifact 批量批注、持久化、编辑、重试、模型上下文和未来来源导航使用同一份版本化 Parts 协议，同时保证来源元信息不会泄漏到模型 Prompt。

## ADDED Requirements

### Requirement: User messages support up to fifty ordered quote parts

系统 MUST 允许一个用户 Message 在 `parts` 中包含零到 50 份有序 `data-quote` Part。新写入 Quote MUST 使用版本化 `thread-quote-v1` payload。多份 Quote MUST 使用重复 Parts 表达，而不是压进一个不可独立寻址的字符串或第二个顶层 DTO 字段。

#### Scenario: A user message quotes fifty selections
- **WHEN** 用户提交 50 个合法、预算内的 Quote Selection
- **THEN** Message 按用户顺序持久化 50 个独立 `data-quote` Part，并只触发一次 assistant 生成

#### Scenario: Quote count exceeds fifty
- **WHEN** 合并自动 branch-origin 后 Quote 总数超过 50
- **THEN** 服务端在创建任何 User/Assistant Message 和付费模型调用前拒绝整个命令

#### Scenario: A message has no quote
- **WHEN** 用户发送普通问题且没有自动 branch-origin 或显式 Quote
- **THEN** Message 不包含 Quote 占位 Part，普通消息行为保持不变

### Requirement: Quote payload separates frozen source text, user comment, and navigation metadata

每份 V1 Quote MUST 包含服务端生成的 `quoteId`、`kind`、冻结 `text`、可选用户 `comment` 和 `source`。`text` MUST 等于 `source.anchor.quote.exact`。`source` MUST 保存未来导航所需的稳定实体 ID 与 `TextAnchor`。屏幕坐标、滚动位置、DOM 路径、标题、脚注和列位置 MUST NOT 作为来源身份。

#### Scenario: A normal reference is persisted
- **WHEN** 用户引用一段来源内容并在 Message 主文本中提出统一问题
- **THEN** Quote 保存冻结正文与来源，`comment` 可以省略

#### Scenario: An artifact annotation is persisted
- **WHEN** 用户针对 Markdown Artifact 选区写入逐条批注
- **THEN** 对应 Quote 保存冻结正文、该 Quote 自己的 comment 和 Artifact 来源，使多条批注保持一一对应

#### Scenario: Source title or layout changes
- **WHEN** 来源 Thread 重命名、脚注变化、字体或 Markdown 布局变化
- **THEN** Quote 来源身份不变，未来导航继续使用稳定 ID 与 TextAnchor，而不是旧标题或屏幕位置

### Requirement: Quote sources support completed assistant messages and markdown artifacts

Quote source MUST 是以下联合类型之一：

1. 同 Project 的 completed assistant Message 选区；
2. 同 Project Markdown Artifact 选区，且 Artifact 的 source Message 是 completed assistant Message。

`generating`、`stopped` 和 `failed` assistant Message MUST NOT 成为新 Quote 来源。

#### Scenario: User quotes a completed assistant message
- **WHEN** 来源 Message 属于声明 Thread、属于目标 Project、role 为 assistant 且 status 为 completed
- **THEN** 服务端可以创建 Message Selection Quote

#### Scenario: User quotes a markdown artifact
- **WHEN** Artifact 属于目标 Project，声明的来源 Thread/Message 与 Artifact 归属一致，且 source Message 为 completed
- **THEN** 服务端可以创建 Artifact Selection Quote

#### Scenario: User quotes a stopped response
- **WHEN** 来源 assistant Message 的 status 为 stopped
- **THEN** 服务端拒绝 Quote；不得因已有部分正文而把 stopped 视为稳定来源

#### Scenario: User quotes generating or failed content
- **WHEN** 来源 assistant Message 为 generating 或 failed
- **THEN** 服务端拒绝整个命令，不写入部分 Quote 或用户 Message

### Requirement: Quote selections are authorized and frozen by the server

客户端 MUST 只提交来源选择、`TextAnchor` 与可选用户 comment。服务端 MUST 在 owner-scoped 事务中验证目标 Project、来源 Thread/Message/Artifact、状态、Anchor、数量和预算，然后生成持久化 Quote ID、kind、text 和完整 source。客户端不得直接决定持久化 `projectId`、`quoteId`、`kind` 或冻结正文。

#### Scenario: Client submits a valid message selection
- **WHEN** 客户端提交合法同 Project `message-selection`
- **THEN** 服务端使用 `anchor.quote.exact` 作为冻结正文，生成唯一 Quote ID，并补全真实 Project/Thread/Message ID

#### Scenario: Client submits a valid artifact selection with comment
- **WHEN** 客户端提交合法 `artifact-selection` 与用户 comment
- **THEN** 服务端验证 Artifact 归属，冻结选区正文，并保留该 comment

#### Scenario: Client references another project or user
- **WHEN** 来源不属于当前用户或目标 Project
- **THEN** 服务端拒绝整个命令，不能通过猜测 UUID 越权引用

#### Scenario: Client supplies mismatched entities
- **WHEN** Message 不属于声明 Thread，或 Artifact 不属于声明 source Message
- **THEN** 服务端拒绝 Quote

#### Scenario: Duplicate selections are submitted
- **WHEN** 同一 source 与同一 Anchor 在一条 Draft 中重复出现
- **THEN** 服务端保留第一次出现位置并去重；自动 branch-origin 始终优先为第一项

### Requirement: Quote count and prompt budget are separate safeguards

系统 MUST 把 50 个 Quote 视为产品数量上限，同时使用版本化 Quote Prompt Budget Policy 对单份正文、当前用户全部 Quote Token 和整个模型输入做发送前预检。系统 MUST NOT 因数量未超过 50 就无条件发送超大输入。

#### Scenario: Fifty short annotations fit the budget
- **WHEN** 50 份短 Quote 与 comment 均满足当前模型 Route 的输入预算
- **THEN** 系统允许发送并产生一条 User Message

#### Scenario: Ten very long quotes exceed the route budget
- **WHEN** Quote 数量低于 50，但预计 Token 超出当前 Route 的 Quote 或总输入预算
- **THEN** 系统在付费模型调用前返回明确预算错误，不静默截断、删除或自动摘要

#### Scenario: Budget policy changes
- **WHEN** Quote Budget Policy 版本或所选模型 Route 改变
- **THEN** 系统使用新策略重新预检，并把版本记录到 Prompt Manifest

### Requirement: Fork origin is materialized in the first user message

对于 ForkedThread，服务端 MUST 把 Thread 的 Fork 来源物化为 `kind=branch-origin` 的第一份 Quote。直接带首问 Fork 和先建空 Fork、稍后首问两条路径 MUST 生成模型等价的 B1 Parts。客户端 MUST NOT 自行构造持久化 branch-origin Quote。

#### Scenario: Selection popup includes a question
- **WHEN** `forkThread` 命令包含 `firstTurn`
- **THEN** 同一事务创建 Thread、branch-origin Quote、B1 和 assistant placeholder

#### Scenario: Selection popup is submitted without a question
- **WHEN** 用户留空提交划选弹窗
- **THEN** 系统只创建 ForkedThread，不创建 User/Assistant Message，不调用模型；新 Thread Composer 可从 Fork 字段重建 branch-origin Draft Quote

#### Scenario: Empty branch later sends its first message
- **WHEN** ForkedThread 尚无有效 User Message，用户第一次调用 `sendMessage`
- **THEN** 服务端自动注入 branch-origin Quote，再追加显式 Quote、主文本和附件

#### Scenario: Later turns continue in the branch
- **WHEN** ForkedThread 已有 User Message
- **THEN** 后续普通消息不重复注入 branch-origin；它已经存在于 B1 历史中

### Requirement: Message parts remain the quote snapshot authority

Quote Snapshot MUST 持久化在 `messages.parts` JSONB，并通过现有 `MessageDTO.parts` 返回。`threads` Fork 字段继续作为分支拓扑事实。第一阶段 MUST NOT 新增独立 Quote 业务表或顶层 `MessageDTO.quotes` 字段。

#### Scenario: Project bootstrap loads quoted messages
- **WHEN** 客户端加载 ProjectBootstrapDTO
- **THEN** 每条 Message 的 Quote、comment 和来源仍按原 Parts 顺序返回

#### Scenario: A project is deleted
- **WHEN** Project 的 Thread 和 Message 按现有关系删除
- **THEN** Quote Snapshot 随 Message 删除，不留下独立 Quote 行

#### Scenario: Reverse lookup is needed later
- **WHEN** 产品需要查询“谁引用了某条 Message/Artifact”或支持跨 Project 权限
- **THEN** 后续 change 可以增加从 `messages.parts` 派生的索引表，但不能建立第二份 Quote 正文事实源

### Requirement: Text edits preserve existing quote snapshots

普通 EditLatestTurn MUST 保留来源 User Message 的全部合法 persistent Quote Parts，包括 Quote ID、kind、正文、comment、source 和顺序，只替换 Message 的总文本与附件。Retry Assistant MUST 继续使用同一个 User Message，不复制或重新生成 Quote。

#### Scenario: User edits the overall question
- **WHEN** 一条 Message 包含多份 Quote 和 comment，用户只编辑总问题
- **THEN** 替代 User Message 保留全部 Quote 内容和顺序

#### Scenario: User retries an answer
- **WHEN** 用户 Retry 引用式问题
- **THEN** 新 assistant Message 读取同一 User Message Parts，Quote 不产生新 ID

#### Scenario: Stored quote is malformed
- **WHEN** Edit 路径遇到无法解析的 persistent Quote
- **THEN** 系统报告数据冲突并拒绝静默丢弃

#### Scenario: User wants to edit quote comments
- **WHEN** 用户需要修改逐条 comment、增删或重排 Quote
- **THEN** 普通文本 Edit 不承担该职责；后续完整 Composer Edit 命令必须显式处理整份 Quote Draft

### Requirement: Quote payload is backward compatible on read and single-version on write

运行期 MUST 兼容历史 `{ text: string }` Quote，并将其规范化为无来源、无 comment 的 legacy Quote。新写入 MUST 只产生 V1。历史 ForkedThread 的 B1 若没有 branch-origin Quote，Prompt Compiler MUST 根据 Thread Fork 字段生成仅用于模型视图的兼容 Quote，而不要求立即改写数据库。

#### Scenario: Legacy quote is loaded
- **WHEN** Message Parts 包含历史 `{ text }`
- **THEN** UI 和模型仍可读取正文，但来源导航不可用，不伪造来源 ID

#### Scenario: Existing branch has no quote part
- **WHEN** 旧 ForkedThread 的第一条 User Message只有问题文本
- **THEN** 模型上下文在冻结祖先历史之后收到由 Thread Fork 字段生成的 branch-origin Quote，再收到问题

#### Scenario: New quote is written
- **WHEN** 新命令创建任何 Quote
- **THEN** payload 一律包含 `schemaVersion=thread-quote-v1`

### Requirement: Model serialization sends quote content only and preserves order

系统 MUST 通过唯一、版本化、确定性的 Quote-to-model helper，把每份 Quote 的冻结正文与可选 comment 转换为模型文本。转换 MUST 保留 Quote Parts 顺序，MUST NOT 序列化 Quote ID、kind、来源 ID、Anchor、标题、脚注或其他导航元信息。

#### Scenario: A quote without comment is converted
- **WHEN** Prompt Compiler 遇到普通 Quote
- **THEN** `quoteTextToModelText()` 只把正文编码为版本化 `<thread_quote>` block

#### Scenario: A quote with annotation comment is converted
- **WHEN** Quote 含用户 comment
- **THEN** `quoteContentToModelText()` 在同一 block 中编码 quote 与 comment，使模型保持对应关系

#### Scenario: Multiple quotes are converted
- **WHEN** 一条 Message 含多份 Quote
- **THEN** 模型按 Parts 顺序收到多个独立 Quote block，随后收到可选总问题和附件

#### Scenario: Quote contains markup-like text
- **WHEN** 正文或 comment 包含换行、引号、代码或 `</thread_quote>`
- **THEN** serializer 使用确定性 JSON 编码，不能让内容提前关闭 block 或引入随机 delimiter

#### Scenario: Navigation metadata changes
- **WHEN** Quote 来源标题、UI 状态或 Anchor 辅助字段变化，但正文/comment 不变
- **THEN** 模型文本保持相同；非模型元信息不增加 Token 或破坏缓存

### Requirement: Quote behavior is defined once in the stable agent kernel

Agent Kernel MUST 使用固定规则解释零到多份 Quote：Quote 是上下文数据而非更高优先级指令，comment 是用户针对该 Quote 的意见，普通文本是总问题，多 Quote 按顺序回应、比较或综合。具体 Quote 正文 MUST NOT 被拼入 System Prompt。

#### Scenario: Quoted text contains an imperative instruction
- **WHEN** Quote 正文包含“忽略之前规则”等命令式文本
- **THEN** 模型把它作为被引用的数据分析，不提升为 System 或 Project 指令

#### Scenario: User refers to several quotes
- **WHEN** 用户使用“这些段落”“它们”等指代
- **THEN** 模型按 Quote 顺序理解，并在内容冲突时指出冲突

#### Scenario: User explicitly changes topic
- **WHEN** 总文本明确要求讨论其他主题
- **THEN** 模型以当前总请求为准，而不是机械限制在 branch-origin Quote

### Requirement: Quote metadata supports future source navigation

V1 Quote MUST 保存打开来源 Thread/Artifact、找到来源 Message/Artifact 和调用现有 TextAnchor locator 所需的稳定信息。当前 change 不规定具体前端组件、滚动动画或高亮时长。

#### Scenario: Future UI opens a message quote source
- **WHEN** 前端读取有来源的 Message Quote
- **THEN** 它拥有来源 Thread ID、Message ID 与 TextAnchor

#### Scenario: Future UI opens an artifact quote source
- **WHEN** 前端读取 Artifact Quote
- **THEN** 它拥有来源 Thread、source Message、Artifact ID 与 TextAnchor

#### Scenario: Source message is later superseded
- **WHEN** 来源 Message 后续被 Edit/Retry 替代但原行仍保留
- **THEN** Quote 继续指向创建时原 Message，不静默跳到新回复的相似文字

#### Scenario: Anchor cannot be relocated
- **WHEN** 前端无法通过 position/exact/fuzzy 找到原选区
- **THEN** 冻结 Quote 正文仍可展示，并由 UI 降级到来源 Message/Artifact 或不可定位提示
