## Purpose

定义 Thread Chat User Message 内嵌 Quote 的最小合同，使同 Thread 多引用、划选后 Fork、编辑删除、来源导航与模型输入使用同一份 Message Parts 数据，同时不让 Quote 决定 Child Thread 是否可以存在。

## ADDED Requirements

### Requirement: Quote is an optional ordered User Message part

系统 MUST 使用零到多份有序 `data-quote` Part 表达 User Message 的 Quote。Quote MUST 只存在于 User Message `parts`；系统 MUST NOT 新建 Quote 表、顶层 `MessageDTO.quotes` 或独立 Quote 生命周期。

#### Scenario: A user asks with multiple quotes

- **WHEN** 当前 Thread Composer 提交多份合法 Quote 和一个总体问题
- **THEN** 系统按 Composer 顺序保存多个独立 `data-quote` Part，并只创建一条 User Message

#### Scenario: A user asks without a quote

- **WHEN** Composer 最终不含 Quote
- **THEN** User Message 不保存 Quote 占位，普通文本与文件行为保持不变

### Requirement: New quotes use the minimal V1 schema

新捕获的 Quote MUST 使用 `thread-quote-v1`，并包含非空 `text`、可选 `comment` 和 `source`。Message 来源 MUST 包含 `messageId` 与 `TextAnchor`；Artifact 来源 MUST 另外包含 `artifactId`。`text` MUST 等于 `source.anchor.quote.exact`。

Quote MUST NOT 包含 `required`、Quote ID、创建入口类型、Project ID、Thread ID、来源状态、标题、脚注、屏幕坐标或 DOM 路径。

#### Scenario: A message selection is saved

- **WHEN** 用户提交一个合法 Message 选区
- **THEN** Quote 保存发送时的文本快照、Message ID 与 Anchor，`comment` 可以省略

#### Scenario: An artifact selection is saved

- **WHEN** 用户提交一个合法 Markdown Artifact 选区
- **THEN** Quote 保存文本快照、来源 Message ID、Artifact ID 与 Anchor

#### Scenario: Quote payload disagrees with itself

- **WHEN** `text` 不等于 `source.anchor.quote.exact`
- **THEN** 服务端在写入 Message 和调用模型前拒绝该命令

### Requirement: Ordinary quote sources are current-thread completed sources

普通 Quote 的来源 Message MUST 属于目标 Composer 的当前 Thread，并且状态 MUST 为 `completed`。Artifact Quote 的 Artifact MUST 由该来源 Message 产生。系统 MUST 在所有者范围内做这些最小检查，但 MUST NOT 重新解析来源正文来改写用户提交的 `text` 快照。

#### Scenario: A completed source belongs to the current thread

- **WHEN** 来源 Message 属于目标 Thread、状态为 `completed` 且来源身份合法
- **THEN** 服务端允许创建 Quote

#### Scenario: A source belongs to another thread

- **WHEN** 普通发送命令引用另一个 Thread 的 Message 或 Artifact
- **THEN** 服务端在写入 User Message 和调用模型前拒绝整个命令

#### Scenario: A source is incomplete

- **WHEN** 来源 Message 为 `generating`、`stopped` 或 `failed`
- **THEN** 服务端拒绝创建 Quote

### Requirement: Selection-to-fork prefills a removable quote

一次由划选触发的 Fork MAY 在 Child Composer 中预填一份使用相同 V1 Schema 的 Quote。系统 MUST 允许用户在发送前删除该 Quote，也 MUST 允许用户在已发送后编辑该 User Message 时删除它。Quote 的存在 MUST NOT 成为 Child Thread 的不变量。

预填 Quote 若被保存，MUST 使用 Message 来源；其 `source.messageId`、`text` 与 `source.anchor` MUST 分别等于 Child 的 `forkMessageId`、`anchorText` 与 `forkAnchor`，来源 Message MUST 为 `completed`。系统 MUST 允许用户删除整块预填 Quote，但 MUST NOT 允许把它替换成另一 Message 或同一 Message 的另一段选区。这一规则 MUST NOT 扩展成任意跨 Thread Quote。

#### Scenario: The prefetched quote remains at submission

- **WHEN** 用户保留预填 Quote 并提交问题
- **THEN** Child 第一条 User Message 保存该 Quote，并在继承历史之后把它发送给模型

#### Scenario: The user deletes the prefilled quote before submission

- **WHEN** 用户删除预填 Quote，但仍提交非空总体问题文本
- **THEN** Child 第一条 User Message 不含 Quote；Child 与 `forkContext` 保持不变

#### Scenario: The fork question is empty

- **WHEN** Fork Composer 的总体问题文本为空，无论预填 Quote或文件是否仍在
- **THEN** 系统只创建或保留 Child Thread，不创建 User/Assistant Message，不调用模型；Quote 草稿本身不触发生成

#### Scenario: The prefilled quote is tampered with

- **WHEN** Fork 第一轮保存的 Quote 与 Child 的 `forkMessageId`、`anchorText` 或 `forkAnchor` 不一致
- **THEN** 服务端在创建 User Message 和调用模型前拒绝该命令

#### Scenario: The first child message has no quote

- **WHEN** 服务端或 Prompt 编译器处理一个没有 `data-quote` 的 Child 第一条 User Message
- **THEN** 系统 MUST NOT 根据 `forkAnchor`、`anchorText`、`forkMessageId` 或 `forkContext` 补写或合成 Quote

### Requirement: Editing reflects and saves the final quote list

编辑器 MUST 按原 `parts` 顺序回显现存 Quote。用户 MUST 能删除任意 Quote、调整顺序并编辑 V1 Quote 的 `comment`。MVP 中 V1 Quote 的 `text`、`source` 与 `anchor` MUST 作为同一个只读快照；删除引用通过移除整个 Quote Block 表达。Edit MUST NOT 新增 Quote，也 MUST NOT 改写保留 V1 Quote 的 `text`、`source` 或 `anchor`。

编辑提交 MUST 使用现有 `replacesMessageId` / `supersededAt` 创建替代 User Message，并保存编辑后的最终 Parts。每个保留 Quote MUST 与被替换 Message 中一份不同的旧 Quote 一一对应，任何相同只读快照的数量 MUST NOT 增加。服务端 MUST NOT 从原 Message 或 Thread 字段恢复已删除 Quote。

历史 `{ text: string }` Quote MAY 原样一一保留、排序或删除；它的 `text` MUST NOT 修改，也 MUST NOT 新增 `comment`、`source` 或 `anchor`。把已有旧 Part 带入替代 Message 不视为捕获新 Quote。

#### Scenario: A user removes one of several quotes

- **WHEN** 用户编辑含多份 Quote 的最新 User Message并删除其中一份
- **THEN** 替代 User Message 只保存剩余 Quote，保持它们的最终顺序

#### Scenario: A user removes the fork quote after receiving an answer

- **WHEN** 用户编辑 Child 第一条 User Message并删除原 Fork Quote
- **THEN** 替代 Message 不含该 Quote，新的生成使用编辑后的 Parts；Child 的父子关系与 `forkContext` 不变

#### Scenario: An assistant answer is regenerated

- **WHEN** 用户对未编辑的引用式 User Message重新生成回答
- **THEN** 系统复用该 User Message 已保存的 Quote Parts，不重新抓取或改写它们

#### Scenario: An edit tries to add a cross-thread quote

- **WHEN** Edit payload 新增 Quote，或把已有 Quote 的来源改成另一个 Thread
- **THEN** 服务端在创建替代 Message 和调用模型前拒绝该命令

#### Scenario: An edit duplicates an existing quote

- **WHEN** Edit payload 中某个只读 Quote 快照的数量多于被替换 Message
- **THEN** 服务端在创建替代 Message 和调用模型前拒绝该命令

#### Scenario: A user edits a message with a legacy quote

- **WHEN** 被替换 User Message 包含历史 `{ text }` Quote
- **THEN** 用户可以原样保留、排序或删除该 Quote，但不能修改正文或伪造 V1 来源元信息

### Requirement: Model serialization includes quote text and comment only

系统 MUST 通过唯一、确定性的转换入口，按 Parts 顺序把 Quote 的 `text` 与可选 `comment` 转成模型文本。系统 MUST NOT 向模型发送 Schema 版本、来源类型、Message/Artifact ID 或 Anchor。

#### Scenario: A quote is converted for the model

- **WHEN** Prompt 编译器处理 V1 Quote
- **THEN** 模型只收到安全转义后的 Quote 文本和可选局部批注

#### Scenario: Source metadata changes

- **WHEN** 仅 Quote 的来源定位元信息变化而 `text` 与 `comment` 不变
- **THEN** Quote 的模型可见文本保持完全相同

#### Scenario: A deleted quote has thread anchor data

- **WHEN** User Message 不含 Quote，但所属 Child Thread 仍保存 `forkAnchor` 和 `anchorText`
- **THEN** 这些 Thread 字段不得通过 System、User 或其他隐藏内容发送给模型

### Requirement: Fork inherits exact history without a child-only character cap

系统 MUST 按 `forkContext` 的有序 Message ID 继承完整、原序的历史，MUST NOT 对 Child 单独应用 6000 字符截断，也 MUST NOT 插入伪造的“更早消息已省略”User Message。

#### Scenario: Inherited history exceeds 6000 characters

- **WHEN** `forkContext` 指向的合法历史超过 6000 字符且仍在模型真实上下文限制内
- **THEN** 上下文编译器按原序加载全部 `forkContext` Message，不执行 Child 专属字符截断或插入省略消息

#### Scenario: Exact history exceeds the selected model limit

- **WHEN** 完整请求超过所选模型的真实上下文限制
- **THEN** MVP 在付费模型调用前返回明确错误，不执行静默截断、逐轮重写或 Child 专属摘要

### Requirement: Quote remains after the shared history prefix

具体 Quote MUST 只存在于它所属 User Message 的位置，MUST NOT 拼入早于继承历史的 System。缓存启用 MUST NOT 改变 Prompt 内容顺序、工具权限、强制工具行为或推理设置。

#### Scenario: Two sibling forks share the same ancestor history

- **WHEN** 两个 Child 使用相同模型与 Provider，工具/System 实际文本和历史 Message 的模型可见内容相同，并继承相同 `forkContext`，但最终提交不同 Quote 或不提交 Quote
- **THEN** Quote/Fork 机制本身不在共同历史结束前制造差异，两次请求从各自真实 User Message 开始因 Quote 而不同

#### Scenario: A cache optimization would widen tool permission

- **WHEN** 提高缓存命中需要给当前模式增加原本不允许的工具或取消强制工具选择
- **THEN** 系统拒绝该优化并保留原权限与行为

### Requirement: Compatibility reads actual parts without synthesizing quotes

系统 MUST 能读取历史 `{ text: string }` Quote，并将其视为没有来源导航信息的旧格式。新捕获的 Quote MUST 只产生 V1；Edit MAY 原样带入被直接替换 Message 中已有的旧 Part。兼容逻辑 MUST 只处理实际存在的 Part，MUST NOT 因 Child 身份推断出一个不存在的 Quote。

#### Scenario: A legacy quote exists

- **WHEN** 历史 User Message 包含 `{ type: "data-quote", data: { text } }`
- **THEN** UI 可以回显文本，模型可以接收文本，来源导航可以不可用

#### Scenario: A historical child message has no quote part

- **WHEN** 历史 Child 第一条 User Message 的 Parts 中没有 Quote
- **THEN** UI 与模型都保持没有 Quote，不从 Thread 数据自动生成

### Requirement: Quote persistence requires no new database table

系统 MUST 把 V1 Quote 保存在 `messages.parts` JSONB，并通过现有 Message DTO 返回。Quote MVP MUST NOT 新增 Quote 表或数据库迁移。

#### Scenario: A project reloads quoted messages

- **WHEN** 客户端重新加载 Project
- **THEN** Quote 从所属 User Message Parts 按原顺序恢复，无需第二次 Quote 查询
