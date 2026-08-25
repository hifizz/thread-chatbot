# Thread Chat `/api/v1` 合同

本文是已落地 Route Handler 与共享 Zod Schema 的稳定索引。规范性行为以同目录 [spec.md](./spec.md) 为准；精确字段以 `lib/thread-chat/api/contracts.ts` 的 strict schemas 为可执行合同。

## 通用规则

- 所有领域 ID 是服务端 UUID、不透明字符串；客户端只构造页面 URL，不构造实体 ID，DTO 不返回 `canonicalUrl`。
- JSON request/response 使用 strict Zod Schema，未知字段拒绝。actor 只来自 Session；所有 Query/Command 都执行 owner scope 与归档/业务资格校验。
- user parts 只接受允许的 AI SDK v7 user part；Markdown tool output 只保存 `{ artifactId }`，不嵌入正文。
- Command 在单事务内提交完整原子结果；错误为 `{ error: { code, message, details? } }`，使用一致 HTTP 映射。

## Query API

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/v1/projects` | `status=active|archived|all`、`limit`、opaque `cursor` | `ListProjectsResult` |
| GET | `/api/v1/projects/{projectId}/bootstrap` | path ID | Project、全量轻量 topology、Artifact Summary、唯一 Root bundle |
| GET | `/api/v1/threads/{threadId}/messages` | `limit<=200`、`beforeSequence` | `ThreadMessageBundle` 与窗口边界 |
| GET | `/api/v1/artifacts/{artifactId}` | path ID | 按 ID 返回完整 `Artifact` |

Bootstrap/MessageBundle/SSE 不返回 BaseContext、Prompt History、未打开 Branch 消息或 Artifact 正文。Artifact Summary 的 `changeSequence` 和 totals 由服务端计算。

## Command API

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/v1/projects` | `{ parts, requestedModelId? }` | CreationBundle：Project、Root、user、assistant、queued Run |
| PATCH/DELETE | `/api/v1/projects/{projectId}` | metadata patch / none | Project / 204 |
| POST | `/api/v1/projects/{projectId}/archive|unarchive` | empty | Project |
| PATCH | `/api/v1/threads/{threadId}` | `{ customTitle }` | Branch Thread；Root metadata 被拒绝 |
| POST | `/api/v1/threads/{threadId}/archive|unarchive` | empty | Branch Thread |
| POST | `/api/v1/threads/{threadId}/messages` | `{ parts, requestedModelId? }` | user + assistant + queued Run |
| POST | `/api/v1/threads/{threadId}/forks` | source Message、anchor/quote；不含 Child ID/BaseContext | 新 Child Thread |
| POST | `/api/v1/messages/{messageId}/edits` | `{ parts, requestedModelId? }` | ReplacementBundle |
| POST | `/api/v1/messages/{messageId}/regenerations` | `{ requestedModelId? }` | ReplacementBundle |
| PUT | `/api/v1/messages/{messageId}/feedback` | `{ value: positive|negative|null }` | Feedback DTO |
| POST | `/api/v1/assistant-messages/{id}/stop` | empty | 最新 AssistantRunState |

P0 不提供 user-only append、客户端 BaseContext、通用 Idempotency-Key、双写或 feature flag。

## SSE

`GET /api/v1/assistant-messages/{assistantMessageId}/events?afterEventSequence=N` 返回 `text/event-stream`。每次连接首个业务事件固定为持久化 `run.snapshot`；其后只接受严格递增且大于恢复游标的事件：

- `run.delta`：最新 checkpoint 增量/视图；
- `run.completed`：finalized Message、terminal Run、最新 Artifact Summary；
- `run.failed`：结构化错误与 terminal Run；
- `run.stopped`：terminal Run；
- snapshot/completed 不复制 Artifact 正文。

断开 SSE、刷新或切换页面不停止后台执行。queued/running 刷新后复用同一 `assistantMessageId` 与 MessageRun；显式 Stop API 才写入 stop request。

## 错误与维护

共享错误码覆盖认证、权限、not found、strict validation、归档状态、领域资格、冲突和内部错误；服务端错误堆栈不进入响应。`ThreadChatApiCapabilities` 是 Web UI 与未来 adapter 的 transport-neutral 边界。

后续增删任何字段、Route、事件或错误码时，必须同时更新正式 spec、本文、`contracts.ts`、`capabilities.ts`、`routes.ts`、Route Handler、JSON Transport、合同/权限/原子性/SSE 测试与 OpenSpec strict validation。
