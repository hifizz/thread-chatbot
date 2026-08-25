# ThreadChat V1 API 详细合同

本文是 `design.md` 引用的 API 可实现合同。接口实现、共享 Zod Schema、服务端集成测试和客户端 Transport 必须以本文为准；总表只用于导航。

### D1. API 总表

本节只是能力索引。逐接口的 Path、Query、Body、成功响应、输出类型、错误码、参数关系和手动 Case 以 [ThreadChat V1 API 详细合同](#threadchat-v1-api-详细合同) 为准。

| Method / Path | 功能 | 关键输入 | 核心输出 | 用户场景 |
|---|---|---|---|---|
| `GET /api/v1/projects` | Project 列表 | `status?`, `limit?`, `cursor?` | `ProjectSummary[]` | 打开对话列表 |
| `POST /api/v1/projects` | 首次发送并建 Project | `initialMessage.parts`, `requestedModelId?` | CreationBundle | `/thread-chat/new` 第一次发送 |
| `GET /api/v1/projects/{id}/bootstrap` | 首屏恢复 | projectId | ProjectBootstrap | 打开已有 Project |
| `PATCH /api/v1/projects/{id}` | 更新标题/Target/Instruction | patch 字段 | ProjectEntity | 修改 Project 设置 |
| `POST /api/v1/projects/{id}/archive` | 归档 Project | projectId | ProjectEntity | 从默认列表隐藏 |
| `POST /api/v1/projects/{id}/unarchive` | 取消归档 | projectId | ProjectEntity | 恢复 Project |
| `DELETE /api/v1/projects/{id}` | 永久删除 | projectId；确认由 UI 在调用前完成 | 204 | 删除整个工作项 |
| `GET /api/v1/threads/{id}/messages` | 加载一个 Thread | `limit<=200`, `beforeSequence?` | ThreadMessageBundle | 首次展开 Branch |
| `PATCH /api/v1/threads/{id}` | 更新 Branch 标题 | `customTitle` | ThreadEntity | 重命名分支列 |
| `POST /api/v1/threads/{id}/archive` | 归档 Thread | threadId | ThreadEntity | 收起历史分支 |
| `POST /api/v1/threads/{id}/unarchive` | 取消归档 Thread | threadId | ThreadEntity | 恢复分支 |
| `POST /api/v1/threads/{id}/messages` | 发送并启动回答 | `parts`, `requestedModelId?` | MessageCreationBundle | 普通继续对话 |
| `POST /api/v1/threads/{id}/forks` | 创建 Child Thread | `sourceMessageId`, `anchor?` | ThreadEntity | 从某条 finalized Message 分叉 |
| `POST /api/v1/messages/{id}/edits` | Edit 最后一条 user | `parts`, `requestedModelId?` | ReplacementBundle | 修改最后问题并重答 |
| `POST /api/v1/messages/{id}/regenerations` | Regenerate assistant | `requestedModelId?` | ReplacementBundle | 重新生成最后回答 |
| `PUT /api/v1/messages/{id}/feedback` | 设置评价 | `positive/negative/null` | FeedbackDTO | 点赞/点踩 |
| `GET /api/v1/artifacts/{id}` | 加载 Artifact 内容 | artifactId | ArtifactDTO | 用户打开 Markdown 文档 |
| `GET /api/v1/assistant-messages/{id}/events` | 恢复事件 | `afterEventSequence` | Event stream | 刷新后续接生成 |
| `POST /api/v1/assistant-messages/{id}/stop` | 停止生成 | assistantMessageId | AssistantRunState | 用户点击 Stop |

### D2. 参数之间的决定性关系

以下内容只保留最核心的关系速查；完整 Schema 与所有边界条件见 [ThreadChat V1 API 详细合同](#threadchat-v1-api-详细合同)。

#### 创建 Project

```ts
type CreateProjectRequest = {
  initialMessage: {
    parts: UIMessage["parts"]
  }
  requestedModelId?: string
}
```

没有 projectId/threadId/messageId。服务端在同一事务生成全部身份。

#### 发送 Message

```ts
type SendMessageRequest = {
  parts: UIMessage["parts"]
  requestedModelId?: string
}
```

threadId 只来自 URL path；body 不重复声明，避免两个值冲突。服务端根据 Thread 找到 Project 和权限。

#### Fork

```ts
type ForkThreadRequest = {
  sourceMessageId: string
  anchor?: {
    exactQuote: string
    textPosition?: { start: number; end: number }
  }
}
```

sourceThreadId 来自 path。服务端验证 sourceMessage.threadId 等于 path Thread；anchor 是用户选择输入，不是权威 BaseContext。

#### Project Patch

```ts
type PatchProjectRequest = {
  customTitle?: string | null
  target?: ProjectTarget | null
  instruction?: string | null
}
```

字段缺省表示保持不变；显式 null 表示清空。Target 中短期、中期、终极目标属于一个整体值，MVP 一次整体替换。

#### Replacement

```ts
type ReplacementBundle = {
  supersededMessageIds: string[]
  createdMessages: MessageEntity[]
  assistantRun: AssistantRunState
}
```

来源 Message ID 来自 path；body 不提交 replacement ID、sequence 或 supersededAt。

## 1. 合同边界

### 1.1 共同规则

- Base URL 固定为 `/api/v1`。
- JSON 字段使用 `camelCase`，时间使用 UTC ISO 8601 字符串。
- Session 决定 actor；请求不得提交 `ownerUserId` 作为授权依据。
- Path 只放正在操作的既有资源 ID；Body 不重复同一个 ID。
- 待创建的 Project、Thread、Message 和 MessageRun ID 全部由服务端生成。
- JSON Object 默认严格校验；未声明字段返回 `400 validation_error`，不得静默接收 `newThreadId`、`baseContext` 等字段。
- `Message.parts` 必须通过项目基于 AI SDK v7 `UIMessage["parts"]` 建立的共享 Schema。
- 普通 JSON 成功响应统一为 `{ data: T }`；`204` 和 SSE 除外。
- append、Fork 和生成命令不使用 Project/Thread revision 或 `If-Match`。
- P0 不要求 `Idempotency-Key`；同一次按钮交互由客户端 busy guard 防止重复点击。这不是网络级幂等保证。

### 1.2 基础类型

```ts
type ProjectId = string       // 服务端 UUID；客户端按不透明字符串处理
type ThreadId = string
type MessageId = string
type DateTime = string        // UTC ISO 8601，例如 2026-08-25T03:20:10.000Z
type Cursor = string          // 服务端签发的不透明游标，客户端不得解析或构造

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type ApiResponse<T> = {
  data: T
}

type ApiErrorResponse = {
  error: {
    code: ApiErrorCode
    message: string
    details?: JsonValue
  }
}
```

`message` 用于开发者诊断，不作为 UI 稳定文案；客户端分支判断只依赖 `code`。

### 1.3 Message Parts

```ts
import type { UIMessage, UIMessageChunk } from "ai"

type MessageParts = UIMessage["parts"]
type UserMessageParts = UIMessage["parts"]
```

`UserMessageParts` 复用 AI SDK v7 的传输结构，但服务端仍必须做角色侧白名单校验。例如，客户端不得伪造仅应由 assistant 或服务端 Tool 执行产生的 Part。至少包含一个有意义内容的数组才是合法输入；空数组、纯空白文本或未知 Part 必须返回 `validation_error`。

### 1.4 权威 DTO

```ts
type ProjectTargetDTO = {
  ultimate: string | null
  shortTerm: string[]
  midTerm: string[]
}

type ProjectDTO = {
  id: ProjectId
  ownerUserId: string
  autoTitle: string | null
  customTitle: string | null
  target: ProjectTargetDTO | null
  instruction: string | null
  archivedAt: DateTime | null
  createdAt: DateTime
  updatedAt: DateTime
}

type ProjectSummaryDTO = {
  id: ProjectId
  displayTitle: string
  archivedAt: DateTime | null
  updatedAt: DateTime
  threadCount: number
  messageCount: number
}

type ForkSourceSnapshotDTO = {
  schemaVersion: 1
  quote?: string
  sourceRole: "user" | "assistant"
  sourceSequence: number
}

type ThreadDTO = {
  id: ThreadId
  projectId: ProjectId
  parentThreadId: ThreadId | null
  sourceMessageId: MessageId | null
  forkSourceSnapshot: ForkSourceSnapshotDTO | null
  autoTitle: string | null
  customTitle: string | null
  archivedAt: DateTime | null
  createdAt: DateTime
  updatedAt: DateTime
}

type MessageDTO = {
  id: MessageId
  threadId: ThreadId
  sequence: number
  role: "user" | "assistant"
  parts: MessageParts | null
  replacesMessageId: MessageId | null
  supersededAt: DateTime | null
  finalizedAt: DateTime | null
  createdAt: DateTime
}

type AssistantRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"

type AssistantRunStateDTO = {
  assistantMessageId: MessageId
  status: AssistantRunStatus
  modelId: string
  checkpointParts: MessageParts
  eventSequence: number
  error: { code: string; message: string } | null
  stopRequestedAt: DateTime | null
  finishedAt: DateTime | null
}

type ArtifactDTO = {
  id: string
  projectId: ProjectId
  sourceMessageId: MessageId
  kind: string
  title: string
  content: JsonValue
  createdAt: DateTime
}

/**
 * Markdown Artifact 工具完成后的目标 output 协议。
 *
 * 当前项目基线由服务端在工具完成后生成 Artifact ID，再写入领域消息的
 * `message.artifactIds`；V1 契约将这层关系收敛到 AI SDK v7 tool output，
 * 使 Message 本身携带稳定引用，但仍不复制 Markdown 正文。
 */
type MarkdownArtifactToolOutput = {
  artifactId: string
}

type ProjectArtifactSummaryDTO = {
  /** Project Artifact 集合变化时由服务端单调递增；只用于客户端拒绝旧统计。 */
  changeSequence: number

  /** 当前 Project 下全部 Artifact 数量，不受本次响应内联窗口影响。 */
  total: number

  /** 按稳定 Artifact kind 聚合；Markdown 数量读取 `byKind.markdown ?? 0`。 */
  byKind: Record<string, number>
}

type FeedbackValue = "positive" | "negative" | null

type FeedbackDTO = {
  messageId: MessageId
  value: FeedbackValue
  updatedAt: DateTime
}
```

决定性不变量：

- `ThreadDTO.parentThreadId === null` 时，它是 Project 唯一 Root，且三个 Fork 字段必须全部为 `null`。
- `parentThreadId !== null` 时，它是 Branch，`sourceMessageId` 与 `forkSourceSnapshot` 必须非空。
- `MessageDTO.sequence` 由服务端在 Thread 内分配且唯一、单调递增；客户端不得提交。
- user Message 创建时即 finalized；运行中的 assistant Message 可有 `parts=null`、`finalizedAt=null`。
- `AssistantRunStateDTO.assistantMessageId` 必须指向 role 为 assistant 的 Message；每条 assistant Message 恰有一个 Run。
- `status=completed` 时，Message 必须已有不可变 `parts` 和 `finalizedAt`；`status=failed|stopped` 时 `finishedAt` 非空。
- `stopRequestedAt` 非空表示服务端已经接受 Stop；它不等于 Run 已进入 `stopped` 终态。
- Markdown tool result 必须通过 AI SDK v7 Message part 的 output 保存 `artifactId` 引用；其目标 output 必须符合 `MarkdownArtifactToolOutput`，不得把 Markdown 正文复制进 tool result。
- `ArtifactDTO` 只由独立 Artifact Query 返回；ThreadMessageBundle、ProjectBootstrap 和生成事件不得内联 Artifact 正文。
- `ProjectArtifactSummaryDTO.changeSequence` 必须是非负整数，并在该 Project 的 Artifact 集合发生变化时单调递增；它只排序统计快照，不是 revision、ETag 或客户端写入前置条件。
- `ProjectArtifactSummaryDTO.total` 必须等于 `byKind` 所有非负整数值之和；它统计 Project 全量 Artifact，不能退化为客户端当前 `artifactsById` 缓存的数量。

### 1.5 复合响应

```ts
type ThreadMessageBundleDTO = {
  threadId: ThreadId
  messages: MessageDTO[]
  assistantRuns: AssistantRunStateDTO[]
  hasOlderMessages: boolean
  oldestReturnedSequence: number | null
  newestReturnedSequence: number | null
}

type ProjectBootstrapDTO = {
  project: ProjectDTO
  threadTopology: ThreadDTO[]
  artifactSummary: ProjectArtifactSummaryDTO
  initialThread: ThreadMessageBundleDTO
}

type CreationBundleDTO = {
  project: ProjectDTO
  rootThread: ThreadDTO
  artifactSummary: ProjectArtifactSummaryDTO
  userMessage: MessageDTO
  assistantMessage: MessageDTO
  assistantRun: AssistantRunStateDTO
}

type MessageCreationBundleDTO = {
  userMessage: MessageDTO
  assistantMessage: MessageDTO
  assistantRun: AssistantRunStateDTO
}

type ReplacementBundleDTO = {
  supersededMessageIds: MessageId[]
  createdMessages: MessageDTO[]
  assistantRun: AssistantRunStateDTO
}
```

`ThreadMessageBundleDTO.messages` 只返回当前有效时间线，即 `supersededAt === null` 的 Message，并按 `sequence ASC` 排列。旧 replacement Message 仍保存在数据库，但不混入默认 UI 时间线。

`assistantRuns` 必须且只包含本 bundle 中 assistant Message 的 Run；不得返回属于其他 Thread 或未返回 Message 的 Run。Message 通过 tool result 中的 `artifactId` 引用 Artifact；本 bundle 不复制 Artifact 正文。

`ProjectBootstrapDTO.artifactSummary` 与 `CreationBundleDTO.artifactSummary` 是 Project 级统计读模型。它不枚举 Artifact，也不能由客户端根据已加载的 `artifactsById` 重建；首次创建且尚未产生 Artifact 时必须返回 `{ changeSequence: 0, total: 0, byKind: {} }`。

## 2. Project API

### 2.1 列出 Project

```http
GET /api/v1/projects?status=active&limit=50&cursor=...
```

功能：为首页“对话列表”加载轻量 Project 列表，不加载 Thread topology 或 Message 正文。

Query：

```ts
type ListProjectsQuery = {
  status?: "active" | "archived" | "all" // 默认 active
  limit?: number                           // 整数，1..100，默认 50
  cursor?: Cursor                          // 首次请求省略
}
```

成功响应：`200 ApiResponse<ListProjectsResult>`。

```ts
type ListProjectsResult = {
  items: ProjectSummaryDTO[]
  nextCursor: Cursor | null
}
```

决定性关系：

- 排序固定为 `updatedAt DESC, id DESC`；相同时间使用 ID 保证稳定顺序。
- `status=active` 只返回 `archivedAt=null`；`archived` 只返回非空；`all` 返回两者。
- Cursor 绑定 actor、status、排序与上页边界。带 cursor 时更换 status 返回 `400 invalid_cursor`。
- `items.length < limit` 时 `nextCursor` 必须为 `null`。

主要错误：`invalid_query`、`invalid_cursor`、`unauthorized`。

手动 Case：先以 `limit=2` 请求，记录 `nextCursor`；第二次带同一 `status` 和 cursor，预期不重复第一页 ID。再把 `status` 改为 `archived` 并复用 cursor，预期 `invalid_cursor`。

### 2.2 首次发送并创建 Project

```http
POST /api/v1/projects
Content-Type: application/json
```

```ts
type CreateProjectRequest = {
  initialMessage: {
    parts: UserMessageParts
  }
  requestedModelId?: string
}
```

成功响应：`201 ApiResponse<CreationBundleDTO>`。

决定性关系：

- 请求中没有 Project、Thread、Message 或 Run ID。
- `initialMessage.parts` 决定 U1 内容；服务端不得接受客户端提交的 role，U1 固定为 user。
- `requestedModelId` 是请求偏好；服务端校验并选择实际模型，结果以 `assistantRun.modelId` 为准。
- 服务端在同一事务创建 Project、唯一 Root、U1、A1 与 queued Run；U1/A1 属于 Root，且 `U1.sequence < A1.sequence`。
- 初始事务尚未生成 Artifact，因此 `artifactSummary` 必须是 `{ changeSequence: 0, total: 0, byKind: {} }`；后续由生成事件携带最新统计。
- 创建响应只返回服务端资源身份与领域数据，不返回或拼接 Web 页面 URL。客户端必须使用 `project.id` 和集中式路由构造器决定导航目标。
- 模型 Worker 只能在事务提交后唤醒。

主要错误：`validation_error`、`model_not_available`、`unauthorized`。

请求示例：

```json
{
  "initialMessage": {
    "parts": [{ "type": "text", "text": "帮我设计一个支付系统" }]
  },
  "requestedModelId": "provider/model"
}
```

手动 Case：提交合法内容，验证响应五个对象的关联 ID；再提交空 `parts`，预期 400 且数据库没有残留 Project。

### 2.3 加载 Project 首屏

```http
GET /api/v1/projects/{projectId}/bootstrap
```

Path：

```ts
type ProjectPath = { projectId: ProjectId }
```

Body：无。Query：无。

成功响应：`200 ApiResponse<ProjectBootstrapDTO>`。

决定性关系：

- `project.id` 必须等于 path `projectId`。
- `threadTopology` 返回该 Project 全部轻量 Thread，必须恰有一个 `parentThreadId=null` 的 Root。
- 每个 Branch 的 `parentThreadId` 必须能在同一 `threadTopology` 找到，且不得形成环。
- `artifactSummary` 必须统计该 Project 的全部 Artifact，不能只统计客户端已经按 ID 加载的 Artifact。
- `initialThread.threadId` 必须等于 Root ID。
- Root bundle 默认返回最新最多 200 条有效 Message，再按 sequence 升序输出。
- Bootstrap 不返回 BaseContext、Branch Message、Prompt History 或全部 Project Resource 正文。

主要错误：`project_not_found`、`forbidden`、`unauthorized`。

手动 Case：创建 Root + 两个 Branch，仅向 Branch 写入消息。Bootstrap 应返回三个 topology item，但 `initialThread.messages` 只能属于 Root。

### 2.4 更新 Project 元数据

```http
PATCH /api/v1/projects/{projectId}
Content-Type: application/json
```

```ts
type PatchProjectRequest = {
  customTitle?: string | null
  target?: ProjectTargetDTO | null
  instruction?: string | null
}
```

校验边界：

- Body 至少出现一个字段。
- `customTitle` 去除首尾空白后为 1..120 字符；`null` 清除自定义标题。
- `instruction` 最大 20,000 字符；`null` 清除。
- `target.ultimate` 最大 4,000 字符；短期/中期数组各最多 50 项，每项去除首尾空白后为 1..500 字符。
- `target=null` 清除整个 Target；字段缺省则保持原值。

成功响应：`200 ApiResponse<ProjectDTO>`。

决定性关系：

- 缺省字段表示“不修改”，显式 `null` 表示“清空”，二者不得混淆。
- `target` 是一个整体值；提交后一次整体替换，不按数组项做 merge。
- 更新 Project metadata 不得修改 Thread、Message 或其他 Project。
- MVP 使用最后一次成功写入生效，不要求 revision。

主要错误：`validation_error`、`project_not_found`、`forbidden`。

手动 Case：先设置 Target，再只提交 `customTitle`，重新读取 Bootstrap，预期 Target 完全不变；随后提交 `target:null`，预期 Target 被清空。

### 2.5 归档与取消归档 Project

```http
POST /api/v1/projects/{projectId}/archive
POST /api/v1/projects/{projectId}/unarchive
```

Body：无。Query：无。

成功响应：`200 ApiResponse<ProjectDTO>`。

决定性关系：

- archive 将 `archivedAt` 设置为服务端当前时间；重复 archive 返回当前实体，不重复制造副作用。
- unarchive 将 `archivedAt` 清为 `null`；重复 unarchive 返回当前实体。
- 归档只影响默认导航可见性，不删除 Thread、Message 或资源。

主要错误：`project_not_found`、`forbidden`、`unauthorized`。

### 2.6 永久删除 Project

```http
DELETE /api/v1/projects/{projectId}
```

Body：无。Query：无。UI 的二次确认是调用前置条件，不作为可伪造的 `confirmed=true` 参数。

成功响应：`204 No Content`，响应体必须为空。

决定性关系：

- 这是 Project 聚合的唯一永久删除入口。
- 服务端在受控事务中删除其资源、Run、Message、Thread 和 Project；不得暴露单 Message hard delete。
- 成功后 Bootstrap 返回 `project_not_found`。

主要错误：`project_not_found`、`forbidden`、`project_delete_conflict`。

## 3. Thread API

### 3.1 按 sequence 加载 Thread Message

```http
GET /api/v1/threads/{threadId}/messages?limit=200&beforeSequence=...
```

```ts
type GetThreadMessagesQuery = {
  limit?: number           // 整数，1..200，默认 200
  beforeSequence?: number  // 正整数；独占边界
}
```

成功响应：`200 ApiResponse<ThreadMessageBundleDTO>`。

服务端核心查询语义：

```sql
WHERE thread_id = :threadId
  AND superseded_at IS NULL
  AND (:beforeSequence IS NULL OR sequence < :beforeSequence)
ORDER BY sequence DESC
LIMIT :limit + 1
```

服务端取出窗口后丢弃多取的一条，再按 `sequence ASC` 输出。

决定性关系：

- `bundle.threadId` 必须等于 path ID；所有 Message 的 `threadId` 也必须一致。
- `beforeSequence` 是独占边界；不会再次返回等于该值的 Message。
- `oldestReturnedSequence`/`newestReturnedSequence` 分别等于返回数组首/尾 sequence；空数组时均为 `null`。
- 多取到第 `limit+1` 条时 `hasOlderMessages=true`，否则 false。
- sequence 可有间隙；replacement 退出有效时间线后，不得重新编号。

主要错误：`invalid_query`、`thread_not_found`、`forbidden`。

手动 Case：构造有效 sequence `[1, 2, 5, 8]`，以 `limit=2` 首次读取应得到 `[5, 8]`；再以 `beforeSequence=5` 读取应得到 `[1, 2]`，不得因缺少 3、4 报错。

### 3.2 更新 Branch 标题

```http
PATCH /api/v1/threads/{threadId}
Content-Type: application/json
```

```ts
type PatchThreadRequest = {
  customTitle: string | null
}
```

成功响应：`200 ApiResponse<ThreadDTO>`。

决定性关系：

- 只允许 Branch；Root 展示标题由 Project 管理，修改 Root 返回 `root_thread_title_owned_by_project`。
- 字符串规则与 Project customTitle 相同；`null` 清除。
- Body 不接受 projectId、parentThreadId 或 ForkFacts，防止用 metadata API 改写拓扑。

主要错误：`validation_error`、`thread_not_found`、`root_thread_title_owned_by_project`。

### 3.3 归档与取消归档 Branch

```http
POST /api/v1/threads/{threadId}/archive
POST /api/v1/threads/{threadId}/unarchive
```

Body：无。成功响应：`200 ApiResponse<ThreadDTO>`。

决定性关系：

- 只允许 Branch；Root 必须通过 Project archive/unarchive 管理。
- 归档保留 Message、Child Thread、ForkFacts 和 BaseContext。
- 重复命令返回当前状态，不创建额外实体。

主要错误：`thread_not_found`、`root_thread_archive_owned_by_project`、`forbidden`。

### 3.4 在既有 Thread 发送 Message

```http
POST /api/v1/threads/{threadId}/messages
Content-Type: application/json
```

```ts
type SendMessageRequest = {
  parts: UserMessageParts
  requestedModelId?: string
}
```

成功响应：`201 ApiResponse<MessageCreationBundleDTO>`。

决定性关系：

- threadId 只来自 path；Body 不接受 threadId、role、sequence 或新 ID。
- 服务端在同一事务创建 finalized user Message、占位 assistant Message 与 queued Run。
- 两条 Message 获得 Thread 当前最大 sequence 之后的两个新 sequence，但系统不要求整条历史角色交替。
- `assistantRun.assistantMessageId === assistantMessage.id`。
- 当前产品策略下，同 Thread 已存在 queued/running Run 时返回 `thread_generation_in_progress`，且不创建任何 Message。
- Prompt History、Branch BaseContext 和 Project Instruction 由服务端解析；客户端不得提交。

主要错误：`validation_error`、`thread_not_found`、`thread_archived`、`thread_generation_in_progress`、`model_not_available`。

手动 Case：在已有最大 sequence=8 的 Thread 发送，响应 U/A sequence 应大于 8 且递增；同时发起第二次命令，只有一个事务成功，另一个返回冲突且没有半条 Message。

### 3.5 Fork Thread

```http
POST /api/v1/threads/{sourceThreadId}/forks
Content-Type: application/json
```

```ts
type ForkThreadRequest = {
  sourceMessageId: MessageId
  anchor?: {
    exactQuote: string
    textPosition?: {
      start: number // UTF-16 code unit，含 start
      end: number   // UTF-16 code unit，不含 end，且 end > start
    }
  }
}
```

成功响应：`201 ApiResponse<{ thread: ThreadDTO }>`。

决定性关系：

- `sourceThreadId` 来自 path；`sourceMessageId` 是既有资源 ID，二者共同唯一确定 Fork 来源。
- 服务端验证 `sourceMessage.threadId === sourceThreadId`；不满足返回 `fork_source_thread_mismatch`。
- 来源必须未 superseded、已 finalized 且具备 Prompt 资格。assistant 还必须对应 completed Run。
- `anchor` 只表达用户选区。若同时提交 position，则服务端验证 source Message 文本在 `[start,end)` 等于 `exactQuote`。
- position 以来源 Message 的规范文本投影为坐标：按 parts 顺序提取所有 text part，并以单个换行连接；非 text part 不占字符位置。前后端必须复用同一投影函数。
- 客户端不得提交 Child ID、parentThreadId、Project ID、BaseContext 或 ForkSourceSnapshot。
- 服务端事务内计算 BaseContext、生成 ForkSourceSnapshot、创建 Child；Child Project 必须与来源 Thread 相同。

主要错误：`validation_error`、`thread_not_found`、`source_message_not_found`、`fork_source_thread_mismatch`、`fork_source_not_finalized`、`fork_source_superseded`、`fork_anchor_mismatch`。

手动 Case：在 running assistant 上请求，预期 `fork_source_not_finalized` 且没有 Child；完成后再请求，预期返回 Branch，且请求/响应都不暴露 BaseContext。

## 4. Message 与 replacement API

### 4.1 Edit 最后一条有效 user Message

```http
POST /api/v1/messages/{sourceUserMessageId}/edits
Content-Type: application/json
```

```ts
type EditMessageRequest = {
  parts: UserMessageParts
  requestedModelId?: string
}
```

成功响应：`201 ApiResponse<ReplacementBundleDTO>`。

决定性关系：

- Path Message 必须 role=user、未 superseded，并且是当前 Thread 最后一条有效 user Message；否则返回 `fork_required`。
- 该命令不是原地修改：旧 Message 的 parts 和 sequence 永远不变。
- 服务端 supersede 从 source user 开始、所有依赖旧输入的当前有效后缀；角色不需要一问一答。
- 随后在 Thread 尾部创建 replacement user、replacement assistant 和新 queued Run，均使用新 ID、新 sequence。
- `createdMessages` 按 sequence 升序返回，必须恰含一条 user 和一条 assistant；user 的 `replacesMessageId` 指向 source。
- `supersededMessageIds` 是本事务退出默认时间线的完整 ID 集合，客户端据此原子更新 Store。

主要错误：`message_not_found`、`message_not_editable`、`fork_required`、`thread_generation_in_progress`、`model_not_available`。

手动 Case：Thread 有 `U1(seq1), U2(seq2), A1(seq3)`，Edit U2。预期 U2/A1 被 supersede，再追加 U2b/A2；不得因为存在连续 user Message 而拒绝。

### 4.2 Regenerate 当前 assistant Message

```http
POST /api/v1/messages/{sourceAssistantMessageId}/regenerations
Content-Type: application/json
```

```ts
type RegenerateMessageRequest = {
  requestedModelId?: string
}
```

成功响应：`201 ApiResponse<ReplacementBundleDTO>`。

决定性关系：

- Path Message 必须 role=assistant、未 superseded、已 finalized，且原 Run 为 completed。
- MVP 只允许重新生成当前有效时间线最后一个可重新生成的 assistant；历史位置返回 `fork_required`。
- 旧 assistant 的 parts 和 sequence 不更新；事务只设置其 `supersededAt`。
- 服务端在 Thread 尾部创建一条新的 assistant Message，并为它创建唯一 queued Run。
- `createdMessages` 必须恰含一条 assistant；其 `replacesMessageId` 等于 path ID。
- 新 assistant 可获得不同 `modelId`，但来源 Message 内容保持不变。

主要错误：`message_not_found`、`message_not_regeneratable`、`fork_required`、`thread_generation_in_progress`、`model_not_available`。

手动 Case：记录 A1 的 ID、parts、sequence 后 Regenerate。预期返回 A2/R2；重新读取默认时间线只见 A2，但数据库中 A1 的 parts 和 sequence 原样保留。

### 4.3 设置 Message feedback

```http
PUT /api/v1/messages/{assistantMessageId}/feedback
Content-Type: application/json
```

```ts
type PutMessageFeedbackRequest = {
  value: FeedbackValue
}
```

成功响应：`200 ApiResponse<FeedbackDTO>`。

决定性关系：

- 目标必须是已 finalized、completed 且未 superseded 的 assistant Message。
- `positive`/`negative` 使用 upsert；`null` 删除或清空评价，响应仍返回 `value:null`。
- 相同 value 重复 PUT 返回当前结果，不修改 Message 或 Run。

主要错误：`message_not_found`、`message_not_feedback_eligible`、`validation_error`。

## 5. 生成事件与 Stop API

### 5.1 订阅或恢复生成事件

```http
GET /api/v1/assistant-messages/{assistantMessageId}/events?afterEventSequence=42
Accept: text/event-stream
```

```ts
type GetAssistantEventsQuery = {
  afterEventSequence?: number // 非负整数，默认 0
}
```

成功响应：`200 text/event-stream`，不是 `ApiResponse<T>`。

SSE Event：

```ts
type RunSnapshotEvent = {
  type: "run.snapshot"
  cursor: number
  run: AssistantRunStateDTO
  message: MessageDTO
  /** 当前 Project 的最新 Artifact 总量，用于刷新或重连后校正页面统计。 */
  artifactSummary: ProjectArtifactSummaryDTO
}

type RunDeltaEvent = {
  type: "run.delta"
  eventSequence: number
  chunk: UIMessageChunk
}

type RunCompletedEvent = {
  type: "run.completed"
  eventSequence: number
  run: AssistantRunStateDTO
  message: MessageDTO
  /** 本次完成事务提交后的 Project Artifact 总量。 */
  artifactSummary: ProjectArtifactSummaryDTO
}

type RunFailedEvent = {
  type: "run.failed"
  eventSequence: number
  run: AssistantRunStateDTO
}

type RunStoppedEvent = {
  type: "run.stopped"
  eventSequence: number
  run: AssistantRunStateDTO
  message: MessageDTO
}

type AssistantMessageEvent =
  | RunSnapshotEvent
  | RunDeltaEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunStoppedEvent
```

连接语义：

1. 服务端先验证 assistant Message、所属 Project 权限和 Run。
2. 首个业务事件固定为 `run.snapshot`。它是当前持久化 checkpoint，不占用新 event sequence；`cursor === run.eventSequence`。
3. 客户端用 snapshot 原子替换本地 checkpoint，并丢弃本地 `eventSequence <= cursor` 的旧流片段。
4. 若 Run 仍 queued/running，后续只发送 `eventSequence > cursor` 的 live event，且严格递增。
5. 若 snapshot 已是终态，服务端发送 snapshot 后即可关闭；不得创建或重启 Run。
6. `afterEventSequence` 用于校验客户端游标与服务端当前 Run 的关系；缺失事件已由 snapshot 合并恢复，因此 P0 不要求重放每个旧 token delta。
7. 如果客户端游标大于服务端游标，返回 `409 invalid_event_cursor`；如果客户端游标小于服务端保留窗口，仍通过 snapshot 恢复。
8. 网络断开只取消订阅，不停止 Run。客户端用最后接受的 eventSequence 重连。
9. 客户端必须按 `changeSequence` 合并 `run.snapshot` 或 `run.completed` 携带的 `artifactSummary`：更大值原子替换，相同值必须一致，更小值忽略；不得按重复事件自行累加。

HTTP 连接建立前的主要错误：`assistant_message_not_found`、`message_run_not_found`、`invalid_event_cursor`、`forbidden`。连接建立后的运行失败通过 `run.failed` 表达。

手动 Case：A1 running、服务端 cursor=42 时刷新，以 `afterEventSequence=38` 重连。首事件必须是 cursor=42 的 snapshot；后续事件从大于 42 开始，数据库仍只有原 Run。

### 5.2 停止生成

```http
POST /api/v1/assistant-messages/{assistantMessageId}/stop
```

Body：无。成功响应：`200 ApiResponse<AssistantRunStateDTO>`。

决定性关系：

- queued/running Run 设置 `stopRequestedAt` 并返回提交后的最新状态；实际终态可稍后通过事件变为 stopped。
- completed/failed/stopped 已是终态，重复 Stop 直接返回当前状态。
- Stop 不创建 replacement Message 或第二个 Run。
- 如果停止时存在可展示 checkpoint，最终 stopped Message 是否 finalized 由领域规则决定；MVP stopped assistant 仍不得进入 BaseContext 或作为 Fork source。

主要错误：`assistant_message_not_found`、`message_run_not_found`、`forbidden`。

## 6. Artifact API

### 6.1 按 ID 加载 Artifact

```http
GET /api/v1/artifacts/{artifactId}
```

Query：无。Body：无。成功响应：`200 ApiResponse<ArtifactDTO>`。

决定性关系：

- 服务端必须从 Artifact 所属 Project 校验当前 actor 的访问权。
- 返回的 `artifact.id` 必须等于 path `artifactId`。
- Message tool result 中的 `artifactId` 只是引用；Artifact 正文只从本接口返回。
- 客户端可以在 ProjectRuntime 生命周期内按 ID 缓存成功结果；刷新后按需重新加载。

主要错误：`artifact_not_found`、`forbidden`、`unauthorized`。

手动 Case：打开包含 Markdown tool result 的 Message，读取其中 `artifactId` 后请求本接口；预期返回对应 Markdown。使用其他用户 Project 的 artifactId 请求时，预期 not_found/forbidden。

## 7. 错误码与 HTTP 映射

```ts
type ApiErrorCode =
  | "validation_error"
  | "invalid_query"
  | "invalid_cursor"
  | "invalid_event_cursor"
  | "unauthorized"
  | "forbidden"
  | "project_not_found"
  | "thread_not_found"
  | "message_not_found"
  | "assistant_message_not_found"
  | "message_run_not_found"
  | "artifact_not_found"
  | "model_not_available"
  | "thread_archived"
  | "thread_generation_in_progress"
  | "root_thread_title_owned_by_project"
  | "root_thread_archive_owned_by_project"
  | "source_message_not_found"
  | "fork_source_thread_mismatch"
  | "fork_source_not_finalized"
  | "fork_source_superseded"
  | "fork_anchor_mismatch"
  | "message_not_editable"
  | "message_not_regeneratable"
  | "message_not_feedback_eligible"
  | "fork_required"
  | "project_delete_conflict"
  | "internal_error"
```

| HTTP | 使用条件 |
|---:|---|
| 400 | 请求形状、字段值、Query 或客户端游标非法 |
| 401 | 未登录或 Session 无效 |
| 403 | actor 已识别但无访问权；部署也可统一返回 404 防止枚举 |
| 404 | 目标资源不存在或按防枚举策略不可见 |
| 409 | 当前状态发生冲突，例如已有运行中生成、无效事件游标或删除冲突 |
| 422 | 资源存在，但不满足命令资格，例如 Fork source 未 finalized、历史 Edit 必须 Fork |
| 500 | 未预期服务端错误；不得向客户端泄漏堆栈和数据库细节 |

错误示例：

```json
{
  "error": {
    "code": "fork_source_not_finalized",
    "message": "The source assistant message is still running.",
    "details": {
      "assistantMessageId": "msg_123",
      "status": "running"
    }
  }
}
```

## 7. Transport 与测试的强制落点

- 服务端 route 输入、Application Service 命令输入和客户端 Transport 输入必须使用同一合同命名，避免 `id` 在不同层表示不同实体。
- 数据库 Row 不得直接作为 API Response；必须显式映射为本文 DTO。
- 客户端收到响应后先做 Schema 校验，再交给 Action 原子 merge；React 组件不得消费未校验 JSON。
- 每个 Command 的集成测试至少覆盖：成功关联关系、授权失败、Schema 非法、领域资格失败、事务回滚。
- 每个 Query 的集成测试至少覆盖：所属隔离、稳定顺序、空结果、边界窗口和 DTO 不泄漏内部字段。
- `MessageRun.id`、BaseContext、Prompt History、数据库错误与内部 Worker 细节不得进入普通客户端合同。
