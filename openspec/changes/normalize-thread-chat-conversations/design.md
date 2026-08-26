# ThreadChat 规范化会话与独立流任务设计

## 1. 实施契约总览（先定义，再实施）

本节是实现阶段的结构边界。DB schema、共享 TypeScript 类型、API、前端 Store、模块和组件必须先按此边界落地；后续状态机与迁移决策不得绕过这些契约另建平行权威源。

### 1.1 DB schema

所有新表继续位于现有 `dbSchema`，ID 使用 `text` 保存客户端或服务端生成的 UUID，与当前 Better Auth 的 `user.id: text` 一致。时间均为 `timestamp with time zone`。物理表如下：

#### `projects`

| 列                          | 类型/约束                                             | 含义                                       |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| `id`                        | `text primary key`                                    | URL 中的 Project ID，允许客户端预生成 UUID |
| `user_id`                   | `text not null references user(id) on delete cascade` | 唯一所有者                                 |
| `auto_title`                | `text null`                                           | 主线程派生标题                             |
| `custom_title`              | `text null`                                           | 用户标题，展示优先级高于 `auto_title`      |
| `next_footnote`             | `integer not null default 1`                          | 项目级脚注号原子分配器                     |
| `archived_at`               | `timestamptz null`                                    | 会话列表归档状态                           |
| `created_at` / `updated_at` | `timestamptz not null`                                | 创建与最后业务变更时间                     |

索引：`(user_id, updated_at desc)`、`(user_id, archived_at, updated_at desc)`。Project 不保存整棵树 JSON。

#### `threads`

| 列                            | 类型/约束                                                 | 含义                                            |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `id`                          | `text primary key`                                        | Thread ID，允许客户端预生成 UUID                |
| `project_id`                  | `text not null references projects(id) on delete cascade` | 所属 Project                                    |
| `parent_id`                   | `text null references threads(id)`                        | 根线程为 null，分支为父 Thread                  |
| `fork_message_id`             | `text null`                                               | 创建分支的来源 Message；在建表后的约束阶段加 FK |
| `fork_context`                | `jsonb not null default '[]'`                             | 创建时冻结的有序 Message ID 数组                |
| `fork_anchor`                 | `jsonb null`                                              | 现有 `TextAnchor` 的完整结构                    |
| `anchor_text`                 | `text null`                                               | 选区原文，用于标题、引用条与来源说明            |
| `footnote`                    | `integer null`                                            | 根线程为 null；分支为项目内唯一脚注号           |
| `depth`                       | `integer not null`                                        | 根为 0，子线程为父深度 + 1                      |
| `model_id`                    | `text not null`                                           | 下一轮使用的模型注册表 ID                       |
| `auto_title` / `custom_title` | `text null`                                               | Thread 标题双轨；自定义优先                     |
| `title_generation_attempted`  | `boolean not null default false`                          | 保持现有“自动标题只触发一次”语义                |
| `title_generated`             | `boolean not null default false`                          | 自动标题是否成功                                |
| `next_sequence`               | `integer not null default 1`                              | 线程内消息序号分配器                            |
| `archived_at`                 | `timestamptz null`                                        | 为未来线程级隐藏保留；本次 UI 不新增入口        |
| `created_at` / `updated_at`   | `timestamptz not null`                                    | 时间戳                                          |

约束与索引：

- 每个 Project 仅一个 `parent_id is null` 的根线程（partial unique index）（在判断判断某个thread是否为rootThread时必须提取一个util函数用来复用）。
- `(project_id, footnote)` 在 `footnote is not null` 时唯一。
- `(project_id, parent_id)`、`(project_id, fork_message_id)` 建查询索引。
- 根线程必须满足 `depth=0`、`fork_message_id/fork_anchor/anchor_text/footnote` 均为空、`fork_context=[]`；分支必须满足这些来源字段非空。跨表、同 Project 与 `depth=parent.depth+1` 由同一事务中的仓储校验保证。

#### `messages`

| 列                             | 类型/约束                                                              | 含义                                                               |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `id`                           | `text primary key`                                                     | UI Message ID/客户端幂等实体 ID                                    |
| `project_id`                   | `text not null references projects(id) on delete cascade`              | 冗余归属，用于所有权查询与同项目校验                               |
| `thread_id`                    | `text not null references threads(id) on delete cascade`               | 所属 Thread                                                        |
| `sequence`                     | `integer not null`                                                     | 服务端原子分配的线程内顺序                                         |
| `role`                         | `text not null check in ('user','assistant')`                          | system prompt 永远由服务端构造，不入库                             |
| `parts`                        | `jsonb not null`                                                       | `ThreadChatUIMessage['parts']`；生成中可写节流快照，终态写最终快照 |
| `status`                       | `text not null check in ('generating','completed','stopped','failed')` | 用户消息创建即 `completed`；助手消息遵循终态状态机                 |
| `model_id`                     | `text null`                                                            | 助手生成实际模型；用户消息为空                                     |
| `replaces_message_id`          | `text null references messages(id)`                                    | Retry/Regenerate/Edit 新消息指向被取代消息                         |
| `superseded_at`                | `timestamptz null`                                                     | soft-supersede 元数据；不删除、不改旧终态                          |
| `stop_requested_at`            | `timestamptz null`                                                     | Stop 请求审计与幂等                                                |
| `feedback`                     | `text null check in ('up','down')`                                     | 当前互斥反馈，避免再建 generation 旁路身份                         |
| `provider_usage`               | `jsonb null`                                                           | 提供商原始 usage，仅协议/诊断；禁止费用解释                        |
| `finish_reason`                | `text null`                                                            | AI SDK finish reason                                               |
| `error_code` / `error_message` | `text null`                                                            | 安全、可展示的失败分类与文案，不保存密钥/上游响应正文              |
| `started_at` / `finished_at`   | `timestamptz null`                                                     | 执行时间；用户消息无需 started_at                                  |
| `created_at` / `updated_at`    | `timestamptz not null`                                                 | 时间戳                                                             |

约束与索引：

- `(thread_id, sequence)` 唯一；`(project_id, thread_id, sequence)` 用于 owner-scoped 读取。
- `status='generating'` 仅允许 assistant；user 必须为 `completed`。
- `finished_at` 与终态一致，`generating` 的 `finished_at` 为空。
- `(thread_id, superseded_at, sequence)` 支撑当前时间线；`replaces_message_id` 唯一，防止同一活跃来源被两个非幂等 Retry 同时取代。
- 数据库只允许在 `generating` 时更新助手 `parts` 快照与终结字段；终态内容不可变由仓储条件更新和测试保证。

当前时间线定义为该 Thread 中 `superseded_at is null` 的 Message 按 `sequence` 排序。全部 Message 仍在实体集合中，以支持 `fork_context`、来源说明、Artifact 和审计。Edit 只允许最新活跃 user turn：事务同时 supersede 该 user Message 及其当前 assistant（如有），再追加新的 user + assistant。Regenerate/Retry 只允许最新活跃 assistant，supersede 旧 assistant 后追加新 assistant；因此不需要 active-leaf 或版本选择状态。

#### `artifacts`

| 列                          | 类型/约束                                                 | 含义                                            |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `id`                        | `text primary key`                                        | Artifact ID；由工具调用稳定派生或客户端预生成   |
| `project_id`                | `text not null references projects(id) on delete cascade` | 所属 Project                                    |
| `source_message_id`         | `text not null references messages(id)`                   | 不可变来源助手 Message                          |
| `kind`                      | `text not null`                                           | 当前 `markdown/code/note`，保留可扩展字符串契约 |
| `title`                     | `text not null`                                           | 展示标题                                        |
| `content`                   | `text not null`                                           | 完整产物正文                                    |
| `language`                  | `text null`                                               | 代码类语言                                      |
| `metadata`                  | `jsonb not null default '{}'`                             | 非正文扩展信息                                  |
| `created_at` / `updated_at` | `timestamptz not null`                                    | 时间戳                                          |

索引：`(project_id, created_at)`、`(source_message_id)`；来源 Message 被 supersede 不级联删除 Artifact。工具最终输出与 Message 终态在同一 finalize 事务内 upsert，避免孤立产物。

#### `conversation_commands`

该表是幂等收据，不是第二份会话状态。

| 列             | 类型/约束                                             | 含义                                                             |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `user_id`      | `text not null references user(id) on delete cascade` | 命令所有者                                                       |
| `id`           | `text not null`                                       | 客户端 command ID                                                |
| `kind`         | `text not null`                                       | `start/send/fork/edit/retry/stop/feedback/rename/archive/delete` |
| `scope_id`     | `text not null`                                       | Project/Thread/Message 主目标                                    |
| `request_hash` | `text not null`                                       | 规范化语义负载哈希，用于拒绝同 ID 异义重放                       |
| `result`       | `jsonb not null`                                      | 第一次提交的权威 DTO/删除回执                                    |
| `created_at`   | `timestamptz not null`                                | 收据时间                                                         |

主键为 `(user_id, id)`；重复命令先比较 `kind + scope_id + request_hash`，一致则返回 `result`，不一致返回 `409 COMMAND_ID_CONFLICT`。

现有 `attachments` 与 RAG 表保留并继续独立工作；新 Message 的 file parts 只引用已通过现有 owner 检查的 attachment URL/ID。现有 billing/payment 表不删除，但新会话模块不得 import 或访问它们。

### 1.2 共享 TypeScript 类型

共享类型放在 `lib/thread-chat/contracts/`，由 API、仓储和客户端共同引用；DB row 类型不得直接泄露给 React。核心定义如下：

```ts
import type { UIMessage, UIMessageChunk, UITool } from "ai"

export type MessageStatus = "generating" | "completed" | "stopped" | "failed"

export interface ThreadChatMessageMetadata {
  messageId: string
  threadId: string
  modelId?: string
}

export interface ThreadChatDataParts {
  quote: { text: string }
  "research-activity": WebResearchActivity
  "research-route": ResearchRoute
  "research-plan": ResearchPlan
  "artifact-progress": MarkdownGenerationProgress
}

export interface ThreadChatTools {
  createMarkdownArtifact: UITool<
    CreateMarkdownArtifactInput,
    CreateMarkdownArtifactOutput
  >
  // 搜索/深读工具按现有实际 tool set 继续声明；禁止 unknown 后再手写强转。
}

export type ThreadChatUIMessage = UIMessage<
  ThreadChatMessageMetadata,
  ThreadChatDataParts,
  ThreadChatTools
>
export type ThreadChatUIMessageChunk = UIMessageChunk<
  ThreadChatMessageMetadata,
  ThreadChatDataParts
>

export interface ProjectDTO {
  /* id, titles, rootThreadId, archive/timestamps */
}
export interface ThreadDTO {
  /* topology, frozen context, titles, model */
}
export interface MessageDTO {
  id: string
  projectId: string
  threadId: string
  sequence: number
  role: "user" | "assistant"
  parts: ThreadChatUIMessage["parts"]
  status: MessageStatus
  modelId: string | null
  replacesMessageId: string | null
  supersededAt: string | null
  feedback: "up" | "down" | null
  error: { code: string; message: string } | null
  createdAt: string
  finishedAt: string | null
}
export interface ArtifactDTO {
  /* sourceMessageId + existing artifact fields */
}

export interface ProjectBootstrapDTO {
  project: ProjectDTO | null
  threads: ThreadDTO[]
  messages: MessageDTO[] // 含 superseded，但 selector 默认不显示
  artifacts: ArtifactDTO[]
  activeGenerationIds: string[]
}
```

`ThreadChatDataParts` 的实际 key 必须由现有 Markdown Artifact 与 web research 契约逐项迁移；生成中 UI 可携带 `transient: true` 的 `artifact-progress`，持久化 checkpoint/finalize 前统一剥离 transient parts。用户消息以 text/file/data-quote parts 表达；system prompt 只在服务端通过 `instructions/system` 注入。

命令类型全部由 Zod v4 strict schema 派生：`StartProjectCommand`、`SendMessageCommand`、`ForkThreadCommand`、`EditLatestTurnCommand`、`RetryMessageCommand`、`StopMessageCommand`、`SetFeedbackCommand`、`RenameProjectCommand`、`SetProjectArchivedCommand`、`DeleteProjectCommand`。它们统一包含 `commandId`，创建类命令还包含客户端 UUID；响应统一为：

```ts
type CommandResponse<T> =
  { ok: true; replayed: boolean; data: T } | { ok: false; error: ApiErrorDTO }

interface GenerationAcceptedDTO {
  project: ProjectDTO
  thread: ThreadDTO
  userMessage?: MessageDTO
  assistantMessage: MessageDTO
  streamUrl: string
}
```

流传输只增加应用 envelope，不发明新的消息内容协议：

```ts
type StreamEvent =
  | {
      type: "snapshot"
      message: ThreadChatUIMessage
      throughSeq: number
      replay: StreamReplayChunk[]
    }
  | { type: "chunk"; seq: number; chunk: ThreadChatUIMessageChunk }
  | { type: "terminal"; message: MessageDTO }
  | { type: "heartbeat"; at: string }

interface StreamReplayChunk {
  seq: number
  chunk: ThreadChatUIMessageChunk
}
```

各事件的含义和客户端处理规则：

| `type`      | 何时发送                                                                            | 字段含义                                                                                                                                            | 客户端行为                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`  | SSE 建立后发送的第一条业务事件                                                      | `message` 是服务器此刻的完整回复；`throughSeq` 表示它已包含前多少个原始 chunk；`replay` 是从 sequence 1 到 `throughSeq` 的完整 AI SDK v7 chunk 历史 | 先使用同一个官方 reducer 重放 `replay`，确认重建结果与 `message.parts[]` 等价，再等待实时 chunk。它只同步显示状态，不重新启动模型，也不修改数据库终态 |
| `chunk`     | 模型生成过程中每产生一个 UI Message chunk 时发送                                    | `seq` 是本次生成内从 1 开始连续递增的编号；`chunk` 可以是 text、reasoning、source、file、tool 或 typed data part                                    | 按顺序交给当前连接持有的 AI SDK v7 reducer；不得自行使用 `text += delta` 或为工具、研究状态建立另一套消息协议                                         |
| `terminal`  | Message 已经由唯一 finalize service 收敛到终态时发送，是本次 SSE 的最后一条业务事件 | `message` 是数据库权威 `MessageDTO`，其 status 为 `completed`、`stopped` 或 `failed`                                                                | 用权威 DTO 覆盖生成中状态并关闭 SSE/停止轮询。终态不可逆；Retry 创建新 Message，不把原 Message 改回 `generating`                                      |
| `heartbeat` | 没有新内容时按固定间隔发送                                                          | `at` 是服务器发送心跳的时间                                                                                                                         | 只用于防止 VPS 反向代理回收空闲连接；不更新消息内容、不算生成进度，也不延长或改变模型任务                                                             |

`StreamReplayChunk.seq` 是历史 chunk 在本次生成内的连续编号；`chunk` 必须保持 AI SDK v7 原始 `ThreadChatUIMessageChunk`，不得转换成自定义文本增量。`replay.length` 必须等于 `throughSeq`，且 sequence 必须从 1 连续递增。replay 只保存在进程内 Session，不写数据库，并随终态 Session 的 TTL cleanup 一起释放。

### 1.3 API

新 API 使用 `/api/thread-chat/v1` 命名空间，避免复用包含整树与计费耦合的 `/api/chat`。所有 handler 使用 Next.js 16 原生 `Request`/`Response`/`ReadableStream`，动态参数通过 `await ctx.params` 读取，默认 Node.js runtime 且禁用缓存。

| Method + path                       | 请求/响应                                               | 原子行为                                                                                   |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /projects?archived=false`      | Project 列表                                            | owner-scoped，按 updated_at 排序                                                           |
| `GET /projects/:projectId`          | `ProjectBootstrapDTO`                                   | 返回完整规范化投影；合法但未创建的新 URL 返回 `project:null` 空壳                          |
| `POST /projects/:projectId/start`   | IDs、首条 text/files、modelId                           | 原子创建 Project、根 Thread、user Message、assistant Message、命令收据；提交后启动 Session |
| `PATCH /projects/:projectId`        | rename/archive command                                  | 只更新 custom title 或 archive；返回 ProjectDTO                                            |
| `DELETE /projects/:projectId`       | delete command                                          | owner lock 后级联删除；重复删除返回同一回执                                                |
| `PATCH /threads/:threadId`          | model/title command                                     | 更新下一轮模型或自定义标题，不改变历史 Message modelId                                     |
| `POST /threads/:threadId/messages`  | user/assistant IDs、text/files、modelId                 | 分配两个连续 sequence，创建 turn，提交后启动 Session                                       |
| `POST /threads/:threadId/forks`     | sourceMessageId、anchor、newThreadId、可选首轮 IDs/text | 锁 Project 脚注计数，冻结上下文；有首轮时同事务创建并启动生成                              |
| `POST /messages/:messageId/edit`    | 新 user/assistant IDs、text、commandId                  | 仅最新活跃 user turn；soft-supersede 旧 turn，追加新 turn                                  |
| `POST /messages/:messageId/retry`   | newAssistantMessageId、commandId                        | 仅最新活跃 assistant；soft-supersede 目标，追加新 assistant                                |
| `POST /messages/:messageId/stop`    | commandId                                               | 写 `stop_requested_at` 并请求 Session abort；终态则返回现状                                |
| `PUT /messages/:messageId/feedback` | commandId、`up/down/null`                               | 只允许 owner 对 assistant Message 设置互斥反馈                                             |
| `GET /messages/:messageId`          | `MessageDTO`                                            | 断流/刷新后的权威轮询端点                                                                  |
| `GET /messages/:messageId/stream`   | SSE `StreamEvent`                                       | 仅活跃或宽限期内 Session；先 snapshot，再 chunk/terminal                                   |
| `GET /artifacts/:artifactId`        | `ArtifactDTO`                                           | owner-scoped drawer 延迟读取（bootstrap 也带摘要/现有所需内容）                            |

错误码稳定为 `VALIDATION_ERROR`、`NOT_FOUND`、`COMMAND_ID_CONFLICT`、`STATE_CONFLICT`、`MODEL_NOT_ALLOWED`、`SESSION_NOT_AVAILABLE`、`GENERATION_FAILED`。owner 不匹配与资源不存在都对外表现为 404。命令成功但 Session 已不在内存时，返回的 Message ID 仍可轮询；不得因 SSE 不可用再次执行命令。

`GET .../stream` 使用 fetch 读取 SSE，客户端明确关闭自动重连。响应头包含 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`，并定时发送 heartbeat。连接取消只注销 subscriber，不把 `request.signal` 传给 `streamText`。

### 1.4 前端 Store

保留“单一外部 store + React selector”架构，改为 `zustand/vanilla` 的规范化状态；不引入 Immer。Store 分成业务实体和工作区 UI 两个 slice，但由一个 facade 暴露给现有组件：

```ts
interface ConversationEntityState {
  project: ProjectDTO | null
  threadsById: Record<string, ThreadDTO>
  messagesById: Record<string, MessageDTO>
  messageIdsByThread: Record<string, string[]> // 始终按 sequence
  artifactsById: Record<string, ArtifactDTO>
  artifactOrder: string[]
  streamByMessageId: Record<
    string,
    {
      phase: "connecting" | "live" | "background" | "terminal"
      liveMessage?: ThreadChatUIMessage
      lastEventSeq: number
      pollAttempt: number
    }
  >
  optimisticByCommandId: Record<string, OptimisticPatch>
}

interface WorkspaceUiState {
  view: "columns" | "canvas"
  openThreadIds: string[]
  selectedThreadId: string
  recents: string[]
  canvas: CanvasUiSnapshot
  panelSizes: PanelSizeSnapshot
  expandedNodes: string[]
}
```

业务 actions：`hydrateProject`、`upsertProject/Thread/Message/Artifact`、`applyStreamSnapshot`、`applyStreamChunk`、`reconcileTerminalMessage`、`markBackgroundGeneration`、`begin/commit/rollbackOptimisticCommand`、`removeProject`。流 chunk 通过 AI SDK v7 的 UI Message reducer 归并，不再维护 `text += delta`、独立 Markdown 临时字段或 web research 旁路字段。

关键 selectors：

- `selectVisibleMessages(threadId)`：只投影 `supersededAt === null` 的当前时间线；生成中优先使用 `liveMessage.parts`，终态使用 MessageDTO.parts。
- `selectAllMessageEntities(threadId)`：供 frozen context、来源与调试使用，不直接渲染版本选择器。
- `selectThreadTree()`、`selectChildren(threadId)`、`selectLineage(threadId)`：从 ThreadDTO 的 parent 关系派生。
- `selectForkMarkers(messageId)`、`selectSourceProvenance(threadId)`：从 `forkMessageId/anchor/footnote` 派生，旧来源被 supersede 后仍可解析。
- `selectArtifactsForMessage/Project`：从规范化 Artifact 关系派生。
- `selectDisplayTitle`：`customTitle ?? autoTitle ?? existing fallback`。

工作区 slice 继续按 Project ID 写 localStorage，仅保存布局/打开列/画布/面板状态。它绝不保存业务 Message 或覆盖 bootstrap。命令层使用客户端 UUID 乐观插入临时实体，响应成功后以 DTO 校正；失败只回滚对应 command patch。

### 1.5 模块拆分与依赖方向

```text
lib/thread-chat/
  domain/
    types.ts                 # 领域 ID、状态、TextAnchor、Artifact 等纯类型
    state-machine.ts         # generating -> terminal 与 supersede 判定
    timeline.ts              # 当前时间线、latest turn、可执行动作判定
    fork-context.ts          # 冻结上下文构造/校验
  contracts/
    ui-message.ts            # ThreadChatUIMessage/DataParts/Tools
    dto.ts                   # Project/Thread/Message/Artifact DTO
    commands.ts              # Zod strict schemas + inferred types
    stream.ts                # StreamEvent schema/encoder/decoder
    errors.ts                # 稳定错误码
  persistence/
    project-repository.ts
    thread-repository.ts
    message-repository.ts
    artifact-repository.ts
    command-repository.ts
    transaction.ts           # owner lock、sequence/footnote 分配辅助
  application/
    queries.ts               # list/bootstrap/message/artifact
    start-project.ts
    send-message.ts
    fork-thread.ts
    edit-turn.ts
    retry-message.ts
    stop-message.ts
    set-feedback.ts
    project-mutations.ts
    compile-model-context.ts  # frozen context + 当前 timeline -> ModelMessage
    title-service.ts          # 保持自动标题行为，不依赖计费
  streaming/
    runtime.ts               # 进程启动收敛 + globalThis store
    session-store.ts         # Map、cleanup timer、subscriber 原子注册
    stream-session.ts        # snapshot/chunk/status/AbortController/task Promise
    run-generation.ts        # streamText 与唯一 finalize orchestration
    ui-message-pipeline.ts    # toUIMessageStream/readUIMessageStream
    checkpoint.ts            # generating parts 节流 CAS
    finalize.ts              # completed/stopped/failed 条件提交 + artifacts
  server/
    auth.ts                  # session 与 owner 解析
    route-utils.ts           # parse/respond/error/no-cache
    start-session-after-commit.ts

app/api/thread-chat/v1/...   # 薄 Route Handlers，只做 auth/parse/call/respond

app/thread-chat/
  core/
    types.ts                 # 客户端状态类型，领域类型兼容出口
    store.ts                 # zustand vanilla normalized store
    selectors.ts             # 组件投影
  net/
    client.ts                # JSON API client
    boot/use-thread-chat-boot.ts
    commands/*.ts            # 每个命令的 optimistic + reconcile
    stream/sse-client.ts
    stream/ui-message-reducer.ts
    stream/terminal-poller.ts
  orchestration/...          # 保留现有工作台编排与组件
  chat/...                   # 保留现有消息、composer、toolbar 组件
```

依赖只允许 `route -> application -> persistence/domain/contracts`、`streaming -> application/persistence/domain/contracts`、`client net/store -> contracts`、`component -> client selectors/actions`。`domain/contracts/persistence/streaming` 不得 import React；新链路不得 import `lib/billing/*`、`lib/payments/*`、`lib/chat/usage-store.ts` 或现有 generation billing 类型。

### 1.6 组件拆分与 UX 保留表

| 现有区域/组件                                  | 改造方式                                                         | 可见变化                     |
| ---------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `thread-chat-demo.tsx`、workspace runtime      | 改接 normalized store facade 与 bootstrap DTO                    | 无                           |
| `thread-columns.tsx`                           | selector 提供 ThreadDTO/可见消息/children                        | 无                           |
| `thread-canvas.tsx`、`canvas-node.tsx`         | 从 parentId 派生节点/边，展开对话仍复用 ChatView                 | 无                           |
| `tree-list*`、`thread-switcher*`               | Project API 与 ThreadDTO 替代整树列表/recents 业务数据           | 无；本地 recent 布局继续保留 |
| `chat-view.tsx`、`conversation-message.tsx`    | 渲染 `UIMessage.parts[]` 投影；tool/data/source 交给既有对应视图 | 无                           |
| `conversation-composer.tsx`、模型选择          | 调新命令 API；busy/stop 状态来自 stream slice                    | 无                           |
| `selection-bubble.tsx`、branch actions         | Fork command 原子分配 footnote 与冻结 context，乐观新列/节点     | 无                           |
| `assistant-message-toolbar.tsx`                | Retry/feedback 调新命令；动作可用性来自状态机 selector           | 无                           |
| `turn-variant-picker.tsx`                      | 删除组件、样式入口、active-leaf/variant command 与 selector      | **已批准移除**               |
| `message-artifacts.tsx`、`artifact-drawer.tsx` | ArtifactDTO + tool parts 投影，来源保持 message ID               | 无                           |
| 标题 hooks/topbar                              | 新 title service 和双轨字段                                      | 无                           |
| overlays/toast/help/research panel             | 数据改从 typed data parts/Store selector 获取                    | 无                           |

旧回复被 supersede 后不在父 Thread 当前时间线显示，也不提供切回入口；由它派生的 Thread 仍出现在树、切换器和画布，其来源说明继续使用冻结 `anchor_text` 与来源 Message。若实现过程中发现除此之外的可见交互无法等价投影，必须停止该项并让用户决策。

## 2. Context

动机见 [proposal.md](./proposal.md)。当前 `branch_trees.state` 同时保存拓扑、消息、Artifact 和工作区派生状态，`branch_generations` 又保存一次生成的快照、结果、心跳与 billing 状态；浏览器还维护 active leaf/variant 与流临时字段。三个层面都能改变“当前回复”，是竞态根源。

项目实际为 Next.js 16.3.1、React 19、Drizzle/Postgres、`ai@^7.0.14`、`@ai-sdk/react@^4` 与 `zustand@^5`。Next.js 16 Route Handler 使用 Web API；AI SDK v7 中模型 `TextStreamPart`、传输 `UIMessageChunk` 和最终 `UIMessage.parts[]` 是三层不同类型。设计必须以安装版本类型声明为准，不使用已废弃的 `StreamTextResult.toUIMessageStream()` 路径。

部署目标是用户完全控制的 VPS，并明确固定一个 Next.js 进程/副本。因此进程内 Session 可接受；多实例容错、跨进程续传不是本次目标。HTTP/SSE 连接仍然是不可靠的，不能拥有模型任务。

## 3. Goals / Non-Goals

**Goals:**

- 让数据库成为项目、拓扑、消息终态和 Artifact 的唯一业务权威。
- 让单进程 Session 成为活跃流的唯一运行时权威，并能在无订阅者时完成落库。
- 将每个命令定义成可认证、可幂等重放、可原子提交的事务。
- 复用 AI SDK v7 UI Message 协议表达完整内容，避免每新增工具就扩展平行消息字段。
- 通过 selectors/adapters 保持现有工作台 UI 与本地布局。

**Non-Goals:**

- 不迁移、导出或只读展示旧 `branch_trees/branch_generations` 历史。
- 不实现跨进程 Session、Redis、消息队列、流续传或 token replay。
- 不实现新的计费、credits、余额检查、费用估算或收费审计。
- 不重做 UI、样式系统、组件库或交互信息架构。
- 不把 system prompt 交给客户端持久化或提交。

## 4. Decisions

### D1：消息行就是生成尝试，不再建 generation 版本实体

每次 assistant 尝试创建新的 Message。终态 CAS 条件固定为 `WHERE id=? AND status='generating'`；任何 Retry/Stop/finalize 重入都返回已存在的权威行。Retry 在事务中先校验目标仍为最新活跃 assistant，再创建 B 并 soft-supersede A；B 失败后的新命令创建 C。相同 command ID 只回放 B/C 的创建收据。

替代方案是保留 Message + Generation 两层和 active leaf。它能提供版本切换，但这正是已决定移除的 UX，并会延续两套身份与 merge 逻辑，所以拒绝。

### D2：分支保存 Message ID 冻结上下文

创建分支时，在锁定 Project/父 Thread 的事务中计算：

```text
child.fork_context =
  parent.fork_context
  + parent 当前时间线中从开头到 sourceMessage（含）的 Message IDs
```

该数组只在创建时写一次。子 Thread 自己的后续上下文为 `fork_context` 对应的历史 Message，加上子 Thread 当前时间线。上下文编译从数据库按 ID 读取 `parts[]`，忽略这些历史行是否已 supersede；缺失/跨项目 ID 是数据完整性错误，不静默换成新回复。

替代方案是在每次调用时沿父线程“当前回复”重算，会让 X 随 A→B 漂移，与已确认的“X 和 B 无关”冲突。

### D3：数据库事务先提交，Session 后启动

创建生成命令的事务顺序为：owner lock → idempotency receipt 检查 → 状态校验 → 原子 sequence 分配 → 写 Message/关系/收据 → commit。提交成功后，同一请求进程立即调用 `SessionStore.start()`；它先把 Session 放入 Map，再启动且持有 task Promise。启动同步失败或任务异常都走唯一 finalize service 收敛为 failed。

不能在数据库事务内等待模型，也不能先调用模型再写 Message。前者长时间占锁，后者在写入失败时产生无法归属的付费执行。commit 与 Session 注册间的进程崩溃是单进程无 durable queue 的已知窗口；下一次进程初始化会把该 `generating` 行标为 failed，用户可 Retry。

### D4：使用 AI SDK v7 的 UI Message pipeline，而非 textStream

生成引擎调用 `streamText`，只把 Session 自己的 `AbortController.signal` 作为 abortSignal。使用独立函数：

```text
streamText(...).stream                 -> TextStreamPart
toUIMessageStream({ stream, ... })     -> UIMessageChunk
readUIMessageStream({ stream, ... })   -> evolving UIMessage snapshots
```

`toUIMessageStream` 固定 `responseMessageId=assistantMessage.id`，开启 reasoning/sources，并通过 `onEnd({ responseMessage, isAborted, finishReason })` 提供协议级终结事实。Session 顺序处理每个 chunk：先经 AI SDK reducer 更新完整 snapshot，再编号并广播，保证新订阅获得的 snapshot 覆盖所有已广播 chunk。`runGeneration` 在流消费退出后仅调用一次 finalize；异常、abort 和正常结束都映射到同一个收口函数。

替代方案 `result.textStream` 会丢失工具、来源、推理和 data parts；手写多个字段又会重建当前问题。实例方法 `result.toUIMessageStream()` 在安装版本已标记废弃，不采用。

### D5：Session 使用 globalThis 单例 Map，但明确单进程约束

`SessionStore` 以 `globalThis` Symbol 保存，避免开发 HMR 重复实例；Session 包含 messageId、status、snapshot、eventSeq、AbortController、subscriber Set、finishedAt、task Promise。task Promise 在 Store 内立即附加 catch，任何 handler 不拥有它，也不需要 Next.js `after()` 保活。

订阅方法在同一同步临界段完成“加入 subscriber → 发送 snapshot/throughSeq/replay → 发送之后的事件”；JS 单线程与 snapshot-before-broadcast 规则避免 subscribe race。AI SDK v7 的 `UIMessage.parts[]` 不保留 text/reasoning/tool chunk 的内部 ID，因此 Session 必须在内存保留从 sequence 1 开始的完整原始 UI chunk 日志：迟到的首次 SSE 订阅先用 replay 在同一个官方 reducer 中重建 active 状态，校验结果与 snapshot 等价，再继续处理实时 chunk。日志不写数据库，随终态 Session 的 5 分钟 TTL cleanup 一并释放。cleanup 比较 `now - finishedAt >= ttl`，只删终态、无订阅者的 Session，timer 调用 `unref()`。

这个选择不适用于 PM2 cluster、多容器或滚动双副本。部署 Gate 必须检查只有一个副本和一个 Node 进程。

### D6：断流不重连，轮询数据库终态

首次命令接受后客户端建立一次 fetch-SSE。断开时 abort 本地 reader、保留 live snapshot、标记 background，并以退避间隔轮询 `GET /messages/:id`（建议 1s、2s、2s，之后 3s，上限 5s）。不发送 Last-Event-ID，不自动 reconnect，不要求服务器 replay。

Session 在生成中每 750–1000ms 对变更后的非 transient `parts[]` 做节流 checkpoint，条件仍为 `status='generating'`；finalize 强制 flush 最终 parts。这样刷新可看到最近快照，最终一定由 terminal row 覆盖。断流页面保留的内存快照若比 DB checkpoint 更新，不被较旧的 generating poll 覆盖；只有序号/更新时间更新或终态才能前进。

### D7：后台消费方唯一终结，Stop 只 abort

Stop 命令先 owner/state 校验，幂等写 `stop_requested_at`，再查找 Session 并调用 abort。它不直接把 Message 改成 stopped。`runGeneration` 从 AI SDK `isAborted` 判断 stopped，而不是捕获字符串形态的 AbortError；模型恰好先完成时 CAS 使 completed 获胜。若 Session 已丢失而行仍 generating，Stop 可通过同一“无 Session 遗留收敛”服务将其标为 failed，而不是伪造 stopped。

### D8：Artifact 是独立记录，UI 协议仍保留工具 parts

工具输入/输出按 UI Message tool part 原样保存在 Message；可打开的 Markdown 等长期产物同时写 `artifacts`，tool output 持有 artifactId。生成期间只在 Session snapshot 展示临时进度；finalize 从验证后的最终 tool outputs 收集 Artifact，并与 Message 终态同事务 upsert。不存在“先写 Artifact、Message 失败后孤立”的路径。

### D9：标题保持双轨和一次触发，不复用计费链路

Project 与 Thread 都保存 auto/custom 字段。主 Thread 的自定义标题同时作为 Project 导航标题；selector 按现有优先级展示。首次有效 turn 提交后由独立 title service 异步尝试一次，`title_generation_attempted` 无论成功失败均置 true；标题模型调用不得经过余额或扣费逻辑。

### D10：旧计费代码保留但物理隔离

为避免超出本次 UX 范围，billing 页面与表可暂时留在仓库；新 `/api/thread-chat/v1`、application、streaming 和 title service 通过依赖扫描测试禁止 import 计费模块。`provider_usage` 只保存提供商原始字段，字段名和代码不得出现 cost、credits、billingStatus、charged 等解释。旧 `/api/chat` 不作为新 ThreadChat 调用入口。

### D11：测试沿用项目现有 Node 脚本，并增加协议/并发分层

仓库已有大量 `node --import tsx` 与数据库脚本，且没有直接测试框架依赖；本 change 不为架构改造额外引入 Vitest。纯领域、contracts、Store 和 stream reducer 用现有 Node assert 脚本；仓储/命令/竞态用随机测试用户和事务清理的 Postgres 脚本；真实 UI 必须按仓库规则用 `ego-browser nodejs` 对 localhost 做验收。旧版本切换、billing 和整树持久化测试在 cutover Gate 删除或改写，不能作为新契约通过的假信号。

Gate 2 的 API 验证分为两层，证据不得混称：API contract 测试负责 strict schema、响应 envelope、错误映射、headers 和 Route 文件边界；Route Handler 数据库集成测试携带 Better Auth 签名 session cookie 调用实际 v1 Route exports，并连接专用 `thread-chat-normalized-test` PostgreSQL，完整经过 auth、handler、application、repository 与事务。后者只在 Session 的模型执行位置注入可控 generation，以稳定复现完成、断流、Stop、Retry 和 Artifact，不 mock 会话业务或数据库。它不启动监听端口；部署后的真实网络 HTTP smoke 仍属于 Gate 5。

## 5. 并发与状态流程

### 5.1 Send

```text
client optimistic IDs
  -> POST command
  -> DB transaction + command receipt + generating assistant
  -> JSON accepted
  -> SessionStore.start(messageId)
  -> one-shot SSE snapshot/chunks
  -> checkpoint while generating
  -> finalize CAS + Artifact transaction
  -> terminal event / polling convergence
```

如果重复 POST 到达：命令表返回同一 assistant ID；若 Session 尚活跃则可订阅，否则轮询数据库，绝不二次 `streamText`。

### 5.2 Retry/Regenerate

锁定目标 Thread 与 Message，要求目标是最新可见 assistant 且已终态；同事务分配一个新 sequence、创建 B(`replaces=A`)、设置 A.superseded_at、写收据。A 的 status/parts/Artifact 不变。任何以 A 为来源的分支不更新。非幂等的第二个新 command 在 A 已 supersede 后返回 409。

### 5.3 Edit latest user

只支持现有 UX 中的最新 user turn。事务 soft-supersede 原 user 和当前 assistant（如有），追加新 user 与新 assistant 两行。旧 assistant 若仍 generating，提交后请求其 Session abort；旧 Session 的 finalize CAS 仍可把旧行终结，但旧行保持 superseded，不影响新时间线。

### 5.4 Process initialization

新进程在接受 ThreadChat 命令前初始化 singleton，并把数据库中所有 `generating` Message 视为上一个进程遗留，条件更新为 failed（错误码 `PROCESS_RESTARTED`）。由于部署保证只有一个进程，不需要 lease/heartbeat 判断另一个实例是否仍活跃。初始化必须是一次性 Promise，所有路由 await 它，避免并发首请求重复 sweep。

## 6. Risks / Trade-offs

- [单进程崩溃会丢失活跃任务] → 启动时明确标 failed、保留 checkpoint、允许新 Retry；部署禁止多副本，并在未来扩容前另做 durable worker 方案。
- [commit 后、Session 注册前崩溃] → 幂等收据保证不重复创建；重启 sweep 收敛 failed。这是接受的极短不可恢复窗口。
- [SSE 代理缓冲或空闲断开] → no-transform/X-Accel-Buffering、heartbeat、客户端自动切轮询；正确性不依赖流不断。
- [生成 checkpoint 增加 Postgres 写入] → 仅内容变化时 750–1000ms 节流、单 Message 串行写、finalize 强制 flush；上线观测写频率后调常量。
- [AI SDK minor 版本改变 parts/chunks] → 共享类型直接引用安装包、使用官方转换/reducer、协议 fixture 覆盖 text/reasoning/source/tool/data/file；升级必须先过 fixture。
- [完整 parts 含敏感 provider metadata] → 持久化前允许字段清单与大小限制，错误信息脱敏；不保存上游原始请求头或密钥。
- [`fork_context` 数组随深分支变长] → 保存 ID 而非复制内容；编译时批量查询并按数组排序，继续沿用现有 prompt budget 截断策略。
- [无旧数据迁移不可回滚数据] → 上线前备份旧表/数据库快照用于运维回退；产品切换不提供旧数据读取。回滚只能恢复旧应用+旧 schema 快照，不能把新数据自动转换回旧整树。
- [删除 variant 后来源回复在父时间线不可见] → 旧来源实体仍加载，子分支在树/画布/切换器中可访问并展示冻结来源说明；这是已批准版本能力移除的直接结果。
- [现有模块与新模块过渡时形成双写] → Gate 内允许代码未接线，但任何实际请求在某一提交中只能走旧或新路径；切换提交一次替换路由/Store 后立即删除旧写调用。

## 7. Migration Plan

### Gate 0：契约与安全网

落地新 schema/type/API/Store 契约文件与纯状态机测试；建立“新 ThreadChat 代码不得 import billing/旧 generation”检查；记录现有 UI 基线和单进程部署检查。此 Gate 不改生产读写路径。

### Gate 1：规范化数据库与应用命令

生成并审查 Drizzle migration，实现 repositories、owner-scoped queries、幂等收据、sequence/footnote 分配、frozen context、状态 CAS 和 DB 并发测试。先在空开发 schema 验证；不读取旧树。

### Gate 2：独立 Session 与 v1 API

实现 AI SDK UI Message pipeline、Session Store、checkpoint/finalize、Stop、startup sweep、SSE envelope 和所有 v1 handlers。用 fake model stream 验证 text/tool/data/reasoning、subscriber race、断流、Stop/complete、重复命令；此时旧 UI 尚未接线。

### Gate 3：规范化客户端 Store 与现有组件适配

实现 bootstrap、commands、one-shot SSE、polling 和 selectors；逐区替换组件数据源，保留 CSS/DOM 行为。删除 variant picker 入口与 active-leaf client state，但暂不删旧服务端表。

### Gate 4：一次性 cutover

在维护窗口备份数据库，应用新 migration，确认新表为空；将 `/thread-chat` 唯一接线到 v1 API/normalized store。删除运行时对 `branch_trees`、`branch_generations`、旧 generation reconciliation 和计费结算的引用；不迁移、不双写、不 fallback。为保留运维级快速 SQL rollback，切换 migration 将旧表 rename 为明确的 legacy backup 名称而不直接 drop；应用代码不得定义、读取或写入这些备份表，稳定期后的物理清理由独立运维变更完成。

### Gate 5：VPS 验证与发布

执行 typecheck/build、OpenSpec strict、全部新 Node/DB 脚本；使用 `ego-browser nodejs` 验证列/画布/分支/Artifact/刷新/Stop/Retry/标题/本地布局及 variant 消失。检查 Coolify/进程管理器仅 1 replica、无 PM2 cluster、反代 SSE 缓冲关闭。进行受控生成中进程重启演练，确认 failed 收敛与 Retry。

**Rollback：** Gate 0–3 未切流量时直接撤销新代码/空表。Gate 4 后若必须回滚，停止写入、恢复旧应用与上线前数据库快照/备份表；新模型中的会话不承诺回写旧格式。由于用户已接受丢弃旧历史，正常前滚不提供数据层双轨回滚。

## 8. Open Questions

无。会改变规范、架构或 Gate 拆分的决策均已在前置讨论中确定；TTL、checkpoint 间隔和轮询退避属于可通过测试/观测调整的常量，不构成开放产品决策。
