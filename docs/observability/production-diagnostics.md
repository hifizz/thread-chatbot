# 生产环境日志与工具诊断

生产服务端统一使用结构化日志。VPS stdout 始终保留；配置 Axiom 后，同一批服务端日志会同时进入 Axiom，方便搜索、聚合、看板和告警。

## 关联规则

- `sessionId` 沿用 Langfuse 的现有映射：ThreadChat 的 Project ID。
- `traceId` 沿用 `assistantMessageTraceId`：每条 AI 回复的确定性 Trace ID。
- `projectId`、`threadId`、`assistantMessageId` 定位产品中的具体回复。
- `requestId` 标识本轮生成；同轮 model call 与工具日志共享。
- `toolCallId`、`toolName` 关联工具执行与供应商失败。
- `observationId` 在存在活跃遥测 Span 时记录；未启用遥测时可以不存在。

在 Langfuse Sessions 中按 `sessionId` 查 Project，再按 `traceId` 找该回复。只有部署已配置并成功上报 Langfuse 时才有远端 Trace；日志里的 ID 不代表上报成功。不记录查询原文、聊天正文、请求头、密钥或供应商原始响应。

## 服务端日志结构

每条日志都使用固定外层字段：

- `_time`：ISO 时间。
- `level`：`debug` / `info` / `warn` / `error`。
- `message`：稳定事件名，例如 `http.request`、`model.call`、`tool.failure`。
- `source`：当前固定为 `server-log`。
- `service`：当前固定为 `thread-chat`。
- `environment`：来自 `AI_OBSERVABILITY_ENVIRONMENT`，未配置时回退到 `NODE_ENV`。
- `release`：来自 `AI_OBSERVABILITY_RELEASE`。
- `fields`：事件自己的结构化字段。

目前会进入统一日志管线的核心事件包括：

| message | 含义 |
| --- | --- |
| `app.started` | Next.js Node 进程完成可观测性初始化 |
| `http.request` | 页面和 API 请求进入应用，不记录 query string 和请求头 |
| `next.request.error` | Next.js 捕获到的服务端请求错误 |
| `model.call` | 模型真正发起 generate / stream / embed 前的脱敏摘要 |
| `prompt_cache.observation` | Prompt Cache 命中和 token 摘要 |
| `provider.failure` | 上游请求失败，含供应商、操作、HTTP 状态（若有）、分类、耗时 |
| `tool.failure` | 工具返回 `ok:false`，包括缓存失败、无效 URL 和发请求前的预算拦截 |
| `tool.exception` | 工具执行抛出异常 |
| `web.budget_tools_removed` | 下一步可用工具因预算减少；不是已发出网络请求 |
| `stream.error` | SDK 流错误，包括可恢复的工具错误，不代表整轮必然失败 |
| `stream.protocol_error` | UI 消息流归并协议错误 |
| `generation.exception` | 准备或消费生成时抛出的异常 |
| `generation.initialization_error` | 外层生成失败处理路径 |

`durationMs` 为对应操作耗时；`budgetElapsedMs` 为从首次联网开始的累计时间，包含模型思考。`budgetReason` 为 `attempts`、`deadline` 或 `content`。HTTP 状态仅在错误提供时记录，不人为填 500。

## Axiom

Axiom 是服务端日志中心，不替代 stdout。三个变量全部配置后，统一 logger 会把正常日志、警告和错误日志异步批量写入 Axiom；Axiom 不可用或 ingest 失败不会影响聊天请求。

生产环境配置：

```bash
AXIOM_TOKEN=<server-only ingest API token>
AXIOM_DATASET=thread-chat-production
AXIOM_EDGE_URL=https://eu-central-1.aws.edge.axiom.co
```

`AXIOM_EDGE_URL` 使用账号所在 region 对应的 Axiom Edge URL。三个变量缺任意一个都会安全降级为仅 stdout。不要使用 `NEXT_PUBLIC_` 变量，也不要把 token 写入客户端代码。

Axiom 中推荐优先按这些字段查询：`message`、`level`、`service`、`environment`、`release`、`fields.requestId`、`fields.threadId`、`fields.assistantMessageId`、`fields.toolCallId`、`fields.modelId`、`fields.provider`、`fields.sessionId`、`fields.traceId`。可以用 `fields.traceId` 回到 Langfuse 查看同一条 AI 回复。

上线后最简单的连通性检查是搜索 `message == "app.started"`；正常发送一条消息后应能继续看到 `http.request` 和 `model.call`。

## 验证

```bash
node --import tsx e2e/observability/production-diagnostics.test.mjs
node --import tsx e2e/observability/axiom-log.test.mjs
```

覆盖生产环境 429、并发 Session/Trace 隔离、预算拦截、敏感内容不进入日志，以及 Axiom 结构化 stdout、批量 ingest、环境/release 元数据和未配置时安全降级。远端 Langfuse 与真实 Axiom 上报仍需在配置凭据的部署环境中核验。
