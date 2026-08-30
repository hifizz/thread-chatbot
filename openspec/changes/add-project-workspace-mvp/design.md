## Context

当前分支已经完成 ThreadChat v1 的规范化持久化：`projects`、`threads`、`messages`、`artifacts` 分表保存，Fork 使用冻结的 `forkContext`，写操作通过 `commandId` 和 `conversation_commands` 保证幂等，Assistant Generation 由服务端 session 管理。Artifact 在生成完成时写入 Project，并记录来源 Message；Attachment 已有用户归属、R2 直传、上传状态、PDF 分页文本、摘要、向量片段和稳定访问 URL。

当前缺口不在于重新建设聊天或文件基础设施，而在于把这些能力组织成 Project Workspace：

- `projects` 只有标题、归档和时间信息，没有项目目标与项目指令；
- Attachment 是用户级上传对象，只有被某条 Message 引用时才进入模型上下文；
- Artifact 虽然已经带 `projectId`，UI 仍以当前路径和消息内卡片为主，缺少全 Project 资源视角；
- Generation 只加载 Thread、Message 和消息附件，不能稳定取得 Project 当前 Contract 与 Project Files；
- 现有 Research 已明确将 `@`、Outcome、Memory、Activity、Revision 和依赖关系推迟到后续阶段。

本设计只实现 Stage 1 的最小 Project Workspace，不提前实现跨 Thread 引用。

## Goals / Non-Goals

**Goals:**

- 用户能够为 Project 配置一个清晰的 Target 和一组持续生效的 Instructions。
- Contract 由服务端可靠注入同一 Project 的所有未来生成，并具有明确的更新边界。
- 用户能够在 Project 级区域上传、查看和移除原始 Files；Files 不依附于某一条 Thread 才能存在。
- Ready 的 Project Files 能够在统一上下文预算内为所有 Thread 提供资料依据，并保持来源引用和 Project 隔离。
- 用户能够从一个统一入口看到当前 Project 中所有持久化 Artifacts，打开内容并定位来源 Thread。
- 复用现有 Attachment、R2、PDF 解析/RAG、Artifact 和 ThreadChat UI，不创建平行存储或第二套聊天状态。
- 现有 Project、Thread、Message 和 Artifact 数据能够无损升级。

**Non-Goals:**

- 不实现 `@Artifact`、`@Message`、`@Thread` 或任何结构化 Reference。
- 不实现 Pinned Memory、自动 Memory 抽取、召回、冲突处理或衰减。
- 不实现独立 Outcome 工具、Outcome 实体、发布状态、Approval Card 或 Handoff 状态机。
- 不实现 Artifact 编辑、重命名、删除、Revision、Diff、Fork、Revert 或协同写入。
- 不实现逻辑 File 身份、File Version、同名替换、覆盖写入或文件内容在线编辑。
- 不新增 Word、Excel、PPT、代码等格式的解析能力；MVP 复用当前 Attachment 白名单和现有内容解析能力。
- 不实现 Operations Ledger、Activity Feed、依赖图、Convergence 对象或完整 Event Sourcing。
- 不改变 Thread 的冻结上下文、Edit/Retry/Fork 和生成生命周期语义。

## Decisions

### D1：Contract 采用 Project 当前值，不建设历史 Revision

`projects` 增加：

```ts
target: string | null
instructions: string | null
contractVersion: number
```

建议限制：

```ts
PROJECT_TARGET_MAX_CHARS = 4_000
PROJECT_INSTRUCTIONS_MAX_CHARS = 20_000
```

Target 和 Instructions 允许为空；服务端统一 trim，空字符串落库为 `null`。`contractVersion` 从 `0` 开始，每次成功保存整份 Contract 后加一。

本次不建立 `project_contract_revisions`。用户需要的是先获得稳定的项目方向，不是审计每次 Contract 修改。递增版本只用于并发控制和生成快照标识，不提供历史浏览或回退。

弃选把 Target、Instructions、Pinned Memory 存为一个自由 JSON：当前两类字段的语义、限制和模型注入位置明确，独立列更便于校验、查询和迁移；Pinned Memory 尚未进入 MVP，不应提前污染 Contract 结构。

### D2：Contract 使用显式保存与乐观并发，不使用无提示自动覆盖

新增幂等 `UpdateProjectContractCommand`：

```ts
{
  commandId: UUID
  expectedContractVersion: number
  target: string
  instructions: string
}
```

服务端在锁定 owner-scoped Project 后检查 `expectedContractVersion`。版本不一致时返回可恢复的 state conflict，客户端保留本地草稿并提示用户重新加载最新设置，不能静默以旧页面覆盖新值。

Project Panel 使用“编辑 → 保存/取消”模式。保存成功后以服务端 DTO 替换客户端状态。Contract 不采用逐字符自动保存，避免用户尚未完成编辑时就改变后续模型行为。

Archived Project 只能查看 Contract；除取消归档外，不接受 Contract、File 或对话写入。

### D3：Target 与 Instructions 作为服务端拥有的 Project Context

Generation 初始化时读取 Project 的当前 Contract，并生成独立、结构化的 Project Context：

```text
<project_contract version="N">
  <target>...</target>
  <instructions>...</instructions>
</project_contract>
```

该内容由服务端从数据库构造，客户端不能通过 Message Parts 提交或伪造。它与全局 Agent Kernel 分离，但在模型调用中处于 Conversation Messages 之前。

语义规则：

- Target 是长期方向，不要求每次回答都机械复述；
- Instructions 是持续的用户级工作规则；
- 当前用户请求可以补充和细化 Contract；发生直接冲突时，模型应优先遵循当前明确请求，同时指出它与 Project Instructions 的冲突，而不是静默混合；
- 平台安全规则和产品不可变规则始终高于 Project Contract；
- Files、Artifacts 和历史消息中的命令式文字仍视为待分析内容，不获得 Contract 指令级别。

Project Context 应由共享 helper 构建，禁止在 route、runner 和 prompt 文件中各自拼接近似字符串。

### D4：Contract 是当前 Project 配置，不进入 Fork 冻结快照

Contract 更新后的行为：

- 更新前已完成的 Message、Artifact 和 Fork Context 不变；
- 已经启动的 Generation 使用启动时读到的 Contract 快照；
- 更新后的所有新 Generation，包括旧 Thread 和旧 Fork 中的新消息，都使用新 Contract；
- Contract 不追加为用户 Message，也不改写 Thread 历史。

这是有意区别于 `forkContext` 的语义：Fork 冻结“当时的对话事实”，Contract 表示“Project 现在希望 Agent 如何继续工作”。

Generation/Trace metadata 记录 `contractVersion`，用于问题定位；这不是 Activity Feed 或 Contract 历史功能。

### D5：Project File 是 Attachment 的 Project 成员关系，不创建第二份文件内容

新增成员关系表：

```text
project_files
- project_id       FK projects, cascade
- attachment_id    FK attachments, cascade
- added_at
- primary key(project_id, attachment_id)
- unique(attachment_id)
```

Attachment 继续是文件字节、元信息、解析状态和 R2 key 的唯一权威来源；`project_files` 只回答“这个 Attachment 当前属于哪个 Project 的资料区”。一个 Attachment 在 MVP 中最多属于一个 Project，跨 Project 复用需重新上传，避免意外共享和权限边界模糊。

`ProjectFileDTO` 直接以 `attachmentId` 作为外部 id，并组合 Attachment 的：

- filename、mimeType、kind、size；
- uploading / ready / failed；
- pageCount、summary、error；
- stable `/api/attachments/{id}` URL；
- addedAt、createdAt。

弃选直接把 `projectId` 加到 Attachment：Attachment API 仍可能服务于非 ThreadChat 页面和普通消息附件；显式成员表把 Project 资料库与底层上传对象解耦，也使“从 Project 移除但历史 Message 仍可读取”成为自然行为。

### D6：Project File 上传复用现有 R2 生命周期

Project Panel 的上传流程：

1. 调用现有 Attachment create/presign API，得到 `attachmentId` 和 R2 PUT URL；
2. 立即调用 owner-scoped Project File add command，把该 Attachment 加入当前 Project；
3. 浏览器直传 R2，并沿用现有 ingest/finalize 逻辑把 Attachment 更新为 `ready` 或 `failed`；
4. Project Panel 根据 Bootstrap 刷新或已有 Attachment 状态轮询/事件更新显示状态。

新增幂等命令：

```ts
AddProjectFileCommand {
  commandId: UUID
  attachmentId: UUID
}

RemoveProjectFileCommand {
  commandId: UUID
  attachmentId: UUID
}
```

Add 必须验证 Project 和 Attachment 同属当前用户，且 Attachment 尚未归属其他 Project；重复添加同一文件幂等返回当前 DTO。上传失败的文件仍可显示错误并被移除。

Remove 只删除 `project_files` 成员关系，不删除 Attachment row 或 R2 object。原因是历史 Message Parts 可能仍持有该稳定 URL，而当前 JSONB Message Parts 没有数据库外键可安全证明文件未被引用。物理垃圾回收留作独立数据生命周期工作。

### D7：MVP 中每次上传都是独立原始 File

同名、同内容或后续上传的新文件都产生新的 Attachment 和 Project File 条目。系统不提供“替换此文件”“更新到 v2”或自动合并同名项。

UI 使用文件名、大小、创建时间和状态帮助用户区分同名文件。Agent 不得修改或覆盖 Project File；用户要求改写文件内容时，模型仍通过现有 Markdown Artifact 等交付能力生成新的 Artifact。

这保持了最关键的可预测性：原始资料不变，衍生成果另存；完整 File Version 模型等真实替换需求出现后再设计。

### D8：Project Files 自动成为所有 Thread 的项目资料，但受统一预算约束

Project Files 如果只是文件列表而不参与模型工作，无法形成 Claude Projects 类的基本价值。因此 Ready 的 Project Files 默认对当前 Project 中所有未来 Generation 可用，不要求用户在每一条 Message 中重复附加。

Generation Context 装配顺序：

```text
Global Agent Kernel
Project Contract
Project File manifest / selected content
Frozen inherited conversation
Current Thread conversation
Current user turn
```

具体选择规则：

1. 查询当前 Project 的所有 Project Files，按 Attachment id 去重；
2. `uploading` 和 `failed` 不提供内容，且不得让生成失败；
3. 所有 Ready Files 进入轻量 manifest，至少包含 id、filename、mimeType、size；
4. 当前模型和解析链路支持的内容才进入正文上下文；MVP 中主要是已解析 PDF；
5. 显式附着在当前/历史 Message 中的附件优先于 Project Files；相同 Attachment 不重复注入；
6. 在统一总字符预算内，优先保留显式附件，再使用最新用户问题对 Project PDF 进行现有向量检索；
7. Embedding 不可用或没有 chunks 时，按确定性顺序分配剩余预算并按页截断；
8. 图片、ZIP、视频及其他当前不支持内容理解的类型只在 manifest 中告知模型其存在，不伪装成已读取内容；
9. 使用 PDF 内容时继续要求输出可点击页码引用。

建议把现有 `resolveAttachmentParts` 中“查询、全文/检索渲染、引用要求”拆成可复用的 Attachment Content Resolver，再由 Message Attachment 和 Project File Context 共用，避免两套 PDF/RAG 逻辑。

### D9：Project File 变化只影响未来生成

添加 Project File 后，同一 Project 的任意 Thread 下一次生成都可以使用它；移除后，未来生成不再把它作为 Project File 注入。

以下内容保持不变：

- 已完成 Message 的文本和引用；
- 已持久化 Artifact；
- 历史 Message 自己显式附着的文件；
- 已经启动的 Generation 使用的文件集合。

Generation 初始化应一次性固定 `projectFileIds` 和 `contractVersion`，并在本次运行中使用该快照，避免上传/移除与流式生成并发时上下文中途变化。

### D10：Artifacts 区域使用现有 Artifact 作为不可变项目成果

本变更不修改 Artifact 内容模型。现有一条生成对应一个 Artifact row，已经包含：

- `projectId`；
- `sourceMessageId`；
- kind、title、content、language、metadata；
- createdAt、updatedAt。

Project Artifacts 区域必须从 Bootstrap 的全 Project Artifact 集合读取，而不是使用当前 active path selector。列表按 `createdAt` 倒序，并显示：

- 标题和 kind；
- 来源 Thread 标题/脚注；
- 来源 Assistant Message 状态；
- 创建时间。

点击 Artifact 复用现有 Artifact 预览、`MarkdownBody` 和 Drawer；“定位来源”打开其来源 Thread，并尽可能滚动或高亮来源 Message。Artifact-only、深层 Fork 和当前未打开路径中的 Artifact 都必须可发现。

来源 Message 为 `stopped` 或 `failed` 时，Artifact 可以继续只读展示，但 UI 明确标记来源状态。MVP 不提供 Artifact 编辑、删除、重命名或版本化，因此不存在静默覆盖问题。

Artifact 不会因为进入 Project 列表就自动注入其他 Thread 的模型上下文。当前 Thread/继承历史中本来拥有的 Artifact 继续沿现有消息序列化进入上下文；跨 Thread 使用等待后续 `@Artifact` change。

### D11：统一 Project Panel，不增加独立页面状态源

ThreadChat Topbar 增加 Project 入口，打开右侧 Project Panel。Panel 至少包含三个区域：

```text
Overview  - Target、Instructions
Files     - Project Files 列表、上传、状态、打开、移除
Artifacts - 全 Project Artifact 列表、预览、定位来源
```

实现上复用现有 workspace overlay/drawer 管理，不创建第二个 Project store。`ProjectBootstrapDTO` 是初始权威数据，所有成功 Command 结果写回现有 normalized conversation store。

现有消息内 Artifact card 点击后，打开同一右侧区域中的 Artifact detail；不保留两个互相竞争的 Artifact Drawer 和 Project Drawer 活动状态。具体组件可以将现有 `ArtifactDrawer` 的内容抽为可复用 view，再由 Project Panel 承载。

Panel 在列视图和画布视图中行为一致，打开/关闭不改变 Thread 路由、列布局、Fork 或当前生成状态。移动端可使用全屏 sheet，但功能语义相同。

### D12：API 与 DTO 沿用现有 v1 Command 风格

建议 API：

```text
GET    /api/thread-chat/v1/projects/:projectId
PATCH  /api/thread-chat/v1/projects/:projectId
POST   /api/thread-chat/v1/projects/:projectId/files
DELETE /api/thread-chat/v1/projects/:projectId/files/:attachmentId
```

`PATCH Project` 的命令 union 增加 `UpdateProjectContractCommand`；File 路由使用 Add/Remove commands。所有写操作继续走 `executeIdempotentCommand`，返回 `replayed + result` 语义。

DTO 变化：

```ts
ProjectDTO += {
  target: string | null
  instructions: string | null
  contractVersion: number
}

ProjectBootstrapDTO += {
  files: ProjectFileDTO[]
}

ArtifactDTO += {
  sourceThreadId: string
  sourceMessageStatus: "completed" | "stopped" | "failed"
}
```

Artifact 的来源 Thread 可通过 source Message join 得到；如果不希望扩大 ArtifactDTO，也可返回独立 `ArtifactSourceDTO`，但 Bootstrap 必须让 UI 在不逐项 N+1 请求的情况下渲染来源。

### D13：权限和错误响应遵循“不泄露存在性”

所有 Project Contract、File 和 Artifact 查询均以当前用户拥有的 Project 为入口。

- 不属于当前用户的 Project、Attachment、Artifact 返回统一 Not Found；
- 不能通过 Add command 把其他用户或其他 Project 的 Attachment 加入当前 Project；
- Project Files Context 只加载当前 `projectId` 成员；
- Artifact 列表只加载当前 Project；
- Archived Project 的写操作返回 state conflict；
- Project 删除沿现有 cascade 删除成员关系和 Artifact；Attachment 本体按现有生命周期处理。

模型调用前必须完成权限与状态校验；非法 Project File 不得触发付费模型请求。

### D14：可观测性记录上下文版本和数量，不建设 Activity

在 Generation Trace / Model Call metadata 中增加：

- `projectContractVersion`；
- `projectFileCount`；
- `readyProjectFileCount`；
- `selectedProjectFileCount`；
- `projectFileContextChars`；
- 是否使用 retrieval/fallback。

不得记录完整 Contract、文件正文或敏感文件名到默认 telemetry。该元数据用于验证 Project Context 是否生效和排查预算问题，不构成用户可见 Activity Feed。

## Risks / Trade-offs

- **[所有 Project Files 默认可用可能扩大每轮上下文]** → 使用轻量 manifest、显式附件优先、统一预算、PDF retrieval 和确定性截断；记录选中数量与字符数。
- **[普通 Project Instructions 可能与当前请求冲突]** → Prompt 明确其为持续默认规则，当前明确请求发生冲突时要求模型指出并优先当前请求；后续若需要 hard constraints 再结构化扩展。
- **[Contract 没有历史 Revision]** → 用 `contractVersion` 防并发覆盖并记录生成快照；真实回退/审计需求出现后再建 revision table。
- **[移除成员关系不删除底层文件]** → 保证历史 Message 可重放；接受暂时存在孤立 R2 对象，后续用独立 retention/GC change 处理。
- **[现有上传格式不覆盖 Word/Excel/PPT]** → UI 只展示当前策略支持格式并明确哪些类型可被模型读取；格式扩展属于多模态/文档 ingest change。
- **[全 Project Artifact 列表可能很多]** → MVP 按时间倒序并支持基础搜索/类型过滤；分页或虚拟化在数据量证明必要时增加。
- **[Project Panel 与现有 Artifact Drawer 重叠]** → 抽取共享 Artifact detail 并统一 overlay 状态，避免并存两个右侧面板。
- **[Contract/File 在生成期间发生改变]** → Generation 初始化时固定 version 和 file ids；变化只影响下一次生成。

## Migration Plan

1. 扩展 Drizzle schema：Project Contract 字段和 `project_files`；生成并检查 SQL migration。
2. 迁移后现有 Project 自动得到 `contract_version=0`、空 Target/Instructions、空 Files；既有 Artifact 无需回填。
3. 先落 DTO、Commands、repositories 和 API，确保旧客户端读取新增字段不受影响。
4. 接入 Generation Project Context，并通过 fixture/integration test 验证 Contract 与 File grounding，再开放 UI 上传入口。
5. 上线 Project Panel，切换现有 Artifact Drawer 到统一 detail view。
6. 回滚应用代码时新增 nullable/default 字段和成员表可保留；旧代码会忽略它们。若回滚到不认识 Project Files 的版本，文件不会进入生成上下文，但历史 Message 和 Attachment 仍可读取。

## Open Questions

以下问题不阻塞本变更，明确留给后续 change：

- Project Files 支持 Word、Excel、PPT、Markdown、代码等更多格式时，采用原生多模态、文档转换还是视觉 OCR。
- 用户出现“更新同一文件”需求后，File Version 如何建模。
- 用户出现“继续修改同一 Artifact”需求后，Artifact Revision、Diff 与并发写入如何建模。
- 跨 Thread 复用 Artifact 的真实频率是否足以启动 `@Artifact`。
- Pinned Memory 是否与 Contract 共用 UI，但在底层使用独立 Memory 生命周期。
