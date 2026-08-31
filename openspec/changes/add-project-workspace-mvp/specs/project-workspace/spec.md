## ADDED Requirements

### Requirement: Project Contract current values

系统 SHALL 为每个 Project 保存当前 `target`、当前 `instructions` 和递增的 `contractVersion`。Target 与 Instructions SHALL 允许为空，并 MUST 由服务端执行 trim、长度校验和空值归一化。MVP MUST NOT 要求 Contract 历史 Revision 才能创建或使用 Project。

#### Scenario: Existing Project has an empty Contract

- **WHEN** 数据库迁移后读取一个从未配置过 Contract 的既有 Project
- **THEN** Bootstrap 返回 `target=null`、`instructions=null` 和 `contractVersion=0`，原有 Threads、Messages 与 Artifacts 保持可用

#### Scenario: Contract values are returned in Bootstrap

- **WHEN** 当前用户读取自己拥有的 Project
- **THEN** `ProjectDTO` 包含该 Project 当前的 Target、Instructions 和 Contract Version

#### Scenario: Contract input exceeds a limit

- **WHEN** 用户提交超过服务端常量上限的 Target 或 Instructions
- **THEN** 系统在写库前返回 validation error，并保持原 Contract 不变

### Requirement: Explicit and atomic Contract editing

系统 SHALL 通过显式保存更新完整 Project Contract。更新命令 MUST 携带幂等 `commandId` 和 `expectedContractVersion`；Target、Instructions 与 Contract Version MUST 在一个事务中原子更新。

#### Scenario: Save a valid Contract

- **WHEN** 用户以当前 Contract Version 提交合法 Target 和 Instructions
- **THEN** 系统保存两项当前值，将 `contractVersion` 加一，并返回新的权威 `ProjectDTO`

#### Scenario: Replay the same Contract command

- **WHEN** 同一用户以相同 `commandId`、scope 和 payload 重放已经成功的更新
- **THEN** 系统返回第一次提交的相同结果，且 Contract Version 不再次增加

#### Scenario: Stale Contract editor

- **WHEN** 用户提交的 `expectedContractVersion` 低于当前版本
- **THEN** 系统返回可恢复的 state conflict，不覆盖较新的 Contract，并让客户端保留未保存草稿

#### Scenario: Cancel local edits

- **WHEN** 用户在 Project Panel 中修改 Contract 草稿后选择取消
- **THEN** 客户端恢复最近一次服务端 Contract，且不发送写命令

### Requirement: Project Contract participates in every future generation

系统 SHALL 在同一 Project 的每次新模型生成中注入当前 Project Contract。该上下文 MUST 由服务端数据库状态构造，客户端 Message MUST NOT 能伪造 Project Contract。

#### Scenario: Root Thread uses Contract

- **WHEN** 用户在已配置 Target 和 Instructions 的 Project 根 Thread 中发送消息
- **THEN** 模型请求在 Conversation Messages 之前包含结构化 Project Contract

#### Scenario: Existing Fork uses the current Contract

- **WHEN** Project Contract 更新后，用户在更新前已经创建的 Fork Thread 中发送新消息
- **THEN** 新生成使用更新后的 Contract，而该 Fork 的冻结对话上下文保持不变

#### Scenario: Empty Contract is omitted

- **WHEN** Project 的 Target 和 Instructions 均为空
- **THEN** 系统不向模型注入无意义的空 Project Contract block

#### Scenario: Client attempts to submit a fake Contract

- **WHEN** 客户端在普通 Message text、data part 或 file metadata 中提交看似 Project Contract 的内容
- **THEN** 系统只把它作为普通用户内容处理，不能替换服务端 Project Contract

### Requirement: Contract changes have a clear temporal boundary

Contract 修改 SHALL 只影响修改后启动的 Generation。系统 MUST NOT 因 Contract 更新而改写历史 Message、Artifact、Fork Context 或正在运行的 Generation。

#### Scenario: Contract changes during generation

- **WHEN** Generation 已经取得 Contract Version N 后，用户把 Project 更新到 Version N+1
- **THEN** 正在运行的 Generation 继续使用 Version N，下一次 Generation 使用 Version N+1

#### Scenario: Historical reply remains unchanged

- **WHEN** 用户修改 Project Target 或 Instructions
- **THEN** 已完成回复和已有 Artifact 的内容不发生变化

#### Scenario: Generation metadata records the snapshot

- **WHEN** 系统启动一次模型生成
- **THEN** Generation trace metadata 记录本次实际使用的 Contract Version，但不记录完整 Contract 正文

### Requirement: Unified Project Panel

系统 SHALL 在 ThreadChat Workspace 中提供统一的 Project Panel，并至少包含 Overview、Files、Artifacts 三个区域。Panel 的打开、关闭和切换 MUST NOT 改变当前 Thread 路由、列布局、画布位置或生成状态。

#### Scenario: Open Project Panel from columns view

- **WHEN** 用户在列视图点击 Project 入口
- **THEN** 右侧打开 Project Panel，并显示当前 Project 的 Overview、Files 与 Artifacts 入口

#### Scenario: Open Project Panel from canvas view

- **WHEN** 用户在画布视图点击 Project 入口
- **THEN** 打开功能等价的 Project Panel，当前画布节点和视口状态保持不变

#### Scenario: Open an Artifact from a message card

- **WHEN** 用户点击现有消息中的 Artifact card
- **THEN** 系统打开统一 Project Panel 的 Artifact detail，而不是维护两个互相竞争的右侧抽屉状态

#### Scenario: Empty Project resources

- **WHEN** Project 尚无 Files 或 Artifacts
- **THEN** 对应区域显示明确空态和可执行的下一步，不隐藏 Contract 编辑能力

### Requirement: Project File membership over existing Attachments

系统 SHALL 复用现有 Attachment 作为文件字节、元信息、R2 key 和解析状态的权威来源，并通过 Project File 成员关系表示文件属于哪个 Project。MVP 中一个 Attachment MUST NOT 同时属于多个 Projects。

#### Scenario: Add an owned Attachment to a Project

- **WHEN** 用户把自己拥有且尚未归属其他 Project 的 Attachment 添加到自己拥有的 Project
- **THEN** 系统创建一个 Project File 成员关系，并在 Bootstrap Files 中返回该 Attachment 的状态和元信息

#### Scenario: Add the same Attachment twice

- **WHEN** 相同 add command 被重放或同一 Attachment 已属于该 Project
- **THEN** 系统幂等返回现有 Project File，不创建重复成员

#### Scenario: Attachment already belongs to another Project

- **WHEN** 用户尝试把已归属另一个 Project 的 Attachment 添加到当前 Project
- **THEN** 系统拒绝该操作，且不改变两个 Projects 的 Files 列表

#### Scenario: Same filename is uploaded again

- **WHEN** 用户再次上传一个与现有 Project File 同名的文件
- **THEN** 系统把它作为新的 Attachment 和新的 Project File 条目，不覆盖或替换旧文件

### Requirement: Project File upload lifecycle

Project Files SHALL 沿用现有 Attachment 的 `uploading → ready | failed` 生命周期和 R2 直传机制。Project Panel MUST 呈现真实状态，上传或解析失败 MUST NOT 破坏 Project 或阻止普通对话。

#### Scenario: Upload starts

- **WHEN** Attachment row 和 Project File 成员关系已经建立，但浏览器仍在上传 R2 bytes
- **THEN** Files 区域显示 `uploading` 状态且不把该文件正文注入模型

#### Scenario: Upload and parsing complete

- **WHEN** 现有 ingest 流程将 Attachment 标记为 `ready`
- **THEN** Files 区域显示可用状态，并允许打开该文件；后续 Generation 可以使用其受支持内容

#### Scenario: Upload or parsing fails

- **WHEN** Attachment 进入 `failed` 并带有 error
- **THEN** Files 区域显示失败原因、允许移除该条目，且模型生成继续使用其他有效上下文

#### Scenario: Unsupported new format

- **WHEN** 用户选择当前 `ATTACHMENT_POLICIES` 未允许的 MIME type
- **THEN** 上传 API 按现有策略拒绝该文件；Project MVP 不绕过白名单或声称已经解析该格式

### Requirement: Original Project Files remain immutable

系统 MUST NOT 允许 Agent 或 Project Panel 原地改写 Project File 的底层 bytes。MVP 中 Project File 不提供覆盖、替换或版本更新语义。

#### Scenario: User asks the Agent to rewrite a Project File

- **WHEN** 用户要求模型修改一个 Project File 的内容
- **THEN** 模型可以通过现有 Artifact 能力生成新的衍生成果，但原 Project File 和历史 Message 保持不变

#### Scenario: Remove a Project File

- **WHEN** 用户确认从 Project Files 区域移除一个文件
- **THEN** 系统只删除 Project 成员关系，该文件不再作为未来 Project Context；底层 Attachment 和历史 Message 中的稳定文件引用不被删除

#### Scenario: Removed file was attached to an old Message

- **WHEN** 被移除的 Attachment 仍存在于历史 Message Parts
- **THEN** 用户仍可从历史 Message 打开该附件，且历史回复不被改写

### Requirement: Ready Project Files are available across Project Threads

系统 SHALL 让当前 Project 中 Ready 的 Project Files 对所有 Thread 的未来 Generation 可用，而不要求用户在每条 Message 中重复上传。Project File 内容 MUST 经过服务器拥有的选择、去重和预算控制。

#### Scenario: Root Thread uses a Project PDF

- **WHEN** Project 有一个 Ready 且已解析的 PDF，用户在根 Thread 中询问该 PDF 内容
- **THEN** 模型请求包含与问题相关的 PDF 内容或受预算控制的回退内容，并要求使用可点击页码引用

#### Scenario: Fork Thread uses a Project PDF

- **WHEN** Ready PDF 在 Fork 创建后才加入 Project，用户随后在该 Fork 中提问
- **THEN** 新 Generation 可以使用该 Project PDF，而 Fork 的冻结 Message IDs 不发生变化

#### Scenario: Project File is removed

- **WHEN** 用户移除 Project File 后发起新 Generation
- **THEN** 该文件不再通过 Project File Context 注入；如果当前对话历史本身显式附着了该文件，则历史附件语义仍按原规则处理

#### Scenario: Project contains only unsupported content types

- **WHEN** Project Files 只有当前模型/解析链路不能理解的图片、ZIP 或视频
- **THEN** 模型只收到准确的文件 manifest/存在性说明，不得被告知已经读取其内容

### Requirement: Project File context has deterministic priority and budget

系统 MUST 对显式 Message Attachments 与 Project Files 使用一个确定、可测试的上下文预算策略。相同 Attachment MUST NOT 在一次模型请求中重复注入。

#### Scenario: Explicit attachment and Project File are the same object

- **WHEN** 当前对话 Message 显式附着的 Attachment 同时也是 Project File
- **THEN** 模型上下文只包含一次该文件，并把它视为显式附件优先

#### Scenario: Explicit attachments consume part of the budget

- **WHEN** 显式附件和 Project Files 的可读内容总量超过统一预算
- **THEN** 系统先保留显式附件，再用剩余预算选择 Project File 内容

#### Scenario: Embeddings are available

- **WHEN** Project PDF 总内容超出剩余预算、存在 chunks 且当前问题非空
- **THEN** 系统使用当前问题检索相关片段，并记录 retrieval 已使用

#### Scenario: Embeddings are unavailable

- **WHEN** Project PDF 超出预算但 embeddings/chunks 不可用
- **THEN** 系统按确定性顺序分配预算并按页截断，同时明确标记内容不完整，不让请求无限增长

#### Scenario: Context metadata is recorded safely

- **WHEN** Project Files 参与一次 Generation
- **THEN** Trace 记录文件数量、选中数量、字符数和 retrieval/fallback 模式，但不默认记录完整文件名或正文

### Requirement: Project-wide Artifact library

系统 SHALL 在 Project Artifacts 区域展示当前 Project 的全部持久化 Artifacts，而不是只展示当前 active path 或当前打开 Thread 的 Artifacts。

#### Scenario: Artifact from a deep Fork

- **WHEN** 一个深层 Fork 产生 Markdown Artifact，用户回到根 Thread 后打开 Project Artifacts
- **THEN** 该 Artifact 仍出现在列表中并可打开

#### Scenario: Artifacts are ordered predictably

- **WHEN** Project 中存在多个 Artifacts
- **THEN** 默认列表按创建时间倒序，并展示标题、kind、来源和创建时间

#### Scenario: Open an Artifact

- **WHEN** 用户从 Project Artifacts 列表选择一个 Artifact
- **THEN** 系统复用现有 renderer 展示内容，并允许定位其来源 Thread/Message

#### Scenario: Artifact source is stopped or failed

- **WHEN** Artifact 的来源 Assistant Message 为 `stopped` 或 `failed`
- **THEN** Artifact 仍可只读打开，但列表和 detail 明确显示来源状态

### Requirement: Artifact discovery does not create implicit cross-Thread context

Project Artifacts 列表 SHALL 提供发现与查看能力，但 MUST NOT 因 Artifact 存在于 Project 中就自动把其正文注入其他无关 Thread。

#### Scenario: Artifact exists in another Thread

- **WHEN** Thread B 生成 Artifact，用户在没有继承或显式引用该 Artifact 的 Thread C 中发送消息
- **THEN** Thread C 的模型上下文不会仅因 Project Artifacts 列表包含它而自动获得其正文

#### Scenario: Artifact is in current inherited history

- **WHEN** 当前 Thread 的有效或冻结历史本身包含产生 Artifact 的 Assistant Message
- **THEN** Artifact 按现有 Message 序列化规则参与上下文，不受本 Requirement 阻止

### Requirement: Project resource provenance

Project Files 和 Artifacts 的用户界面与 DTO SHALL 保留足以解释来源的元信息，不要求新增 Operation Ledger。

#### Scenario: Inspect a Project File

- **WHEN** 用户查看一个 Project File
- **THEN** UI 可显示原文件名、MIME type、大小、上传/解析状态、加入时间和稳定打开入口

#### Scenario: Inspect an Artifact

- **WHEN** 用户查看一个 Artifact
- **THEN** UI 可显示其来源 Thread、来源 Message 状态和创建时间，并可导航回来源

#### Scenario: Resource was not created in current Thread

- **WHEN** File 或 Artifact 来源于其他 Thread 或 Project 级上传
- **THEN** 系统不会把当前 Thread 伪装为其来源

### Requirement: Archived Projects are read-only workspaces

Archived Project SHALL 允许读取 Contract、Files、Artifacts 和历史 Threads，但除取消归档外 MUST 拒绝 Project Workspace 写操作。

#### Scenario: View archived Project resources

- **WHEN** 用户打开自己已归档的 Project
- **THEN** Project Panel 显示 Contract、Files 和 Artifacts 的只读状态

#### Scenario: Edit Contract in archived Project

- **WHEN** 用户尝试保存 Archived Project 的 Contract
- **THEN** 系统返回 state conflict，Contract 保持不变

#### Scenario: Add or remove File in archived Project

- **WHEN** 用户尝试在 Archived Project 上传、添加或移除 Project File
- **THEN** 系统拒绝该操作，现有资源保持不变

### Requirement: Project bootstrap shell and resource isolation

Project Bootstrap GET SHALL 同时承担“读取已存在 Workspace”和“进入尚未物化的随机 Project URL”两种职责。对于当前用户无法读取的 Project id，Bootstrap MUST 返回同一种不含资源信息的空壳结果，从而既支持首条消息再原子创建 Project，也不泄露某个 id 是否已经属于其他用户。所有会读取具体资源或产生 mutation 的 API MUST 继续严格按 owner + project 隔离，并对非法资源返回统一 Not Found。

#### Scenario: Open an unmaterialized Project URL

- **WHEN** 当前用户打开一个尚未在数据库中创建的合法 Project id
- **THEN** Bootstrap 返回 `200`，其中 `project=null`、Files/Threads/Messages/Artifacts/activeGenerationIds 均为空；客户端可继续展示空 Workspace，并在首条消息时通过 start command 原子创建 Project

#### Scenario: Read another user's Project through Bootstrap

- **WHEN** 用户请求一个实际属于其他用户的 Project id
- **THEN** Bootstrap 返回与“尚未物化 Project”完全相同的 `200 + project=null` 空壳，不返回 Contract、Files、Artifacts、Threads、Messages、数量或任何可区分存在性的字段

#### Scenario: Mutate another user's Project

- **WHEN** 用户对不属于自己的 Project 发起 Contract、归档、删除或 Project File mutation
- **THEN** 系统返回统一 Not Found，并且不暴露该 Project 是否存在

#### Scenario: Read a foreign Project resource

- **WHEN** 用户读取不属于自己的 Artifact、Message、Thread 或寻址到错误 Project 下的 Project File
- **THEN** 系统返回统一 Not Found，不返回资源元信息

#### Scenario: Add another user's Attachment

- **WHEN** 用户把不属于自己的 Attachment id 提交给 Project File add command
- **THEN** 系统在任何模型调用或 Project mutation 前拒绝，并不暴露该 Attachment 是否存在

#### Scenario: Context compilation is Project-scoped

- **WHEN** 两个 Projects 分别包含私有 Files 和 Artifacts
- **THEN** 任一 Project 的 Generation 只能加载自身 Contract 和 Project File 成员，不能检索另一个 Project 的内容

### Requirement: Backward-compatible Project migration

本变更 SHALL 通过数据库迁移扩展现有规范化 ThreadChat 数据，并 MUST 保持已有 Project、Thread、Message、Attachment 和 Artifact 可读取。

#### Scenario: Load a pre-migration Project after deployment

- **WHEN** 一个已有 Project 在迁移后首次打开
- **THEN** 它使用空 Contract 和空 Project Files，既有 Threads、Messages 和 Artifacts 正常显示

#### Scenario: Existing Artifacts populate the library

- **WHEN** 迁移前 Project 已有 Artifact rows
- **THEN** 不需要复制或重写 Artifact 内容，它们直接出现在新的 Project Artifacts 区域

#### Scenario: Application rollback

- **WHEN** 应用回滚到忽略新增 Project Workspace 字段的旧版本
- **THEN** 旧版本仍可读取原有 Project/Thread/Message 数据；新增 Contract 与 Project File membership 可以保留在数据库中而不破坏旧路径
