# 生产环境工具诊断

生产服务日志搜索 `[ai-diagnostic]`。无需额外开关，也不依赖 Langfuse 已启用。

## 关联规则

- `sessionId` 沿用 Langfuse 的现有映射：ThreadChat 的 Project ID。
- `traceId` 沿用 `assistantMessageTraceId`：每条 AI 回复的确定性 Trace ID。
- `projectId`、`threadId`、`assistantMessageId` 定位产品中的具体回复。
- `requestId` 标识本轮生成；同轮 `[model-call]` 与工具日志共享。
- `toolCallId`、`toolName` 关联工具执行与供应商失败。
- `observationId` 在存在活跃遥测 Span 时记录；未启用遥测时可以不存在。

在 Langfuse Sessions 中按 `sessionId` 查 Project，再按 `traceId` 找该回复。只有部署已配置并成功上报 Langfuse 时才有远端 Trace；日志里的 ID 不代表上报成功。不记录 URL、查询原文、聊天正文、请求头、密钥、错误 message/stack 或供应商原始响应。

## 事件

| event | 含义 |
| --- | --- |
| `provider.failure` | 上游请求失败，含供应商、操作、HTTP 状态（若有）、分类、耗时 |
| `tool.failure` | 工具返回 `ok:false`，包括缓存失败、无效 URL 和发请求前的预算拦截 |
| `tool.exception` | 工具执行抛出异常 |
| `web.budget_tools_removed` | 下一步可用工具因预算减少；不是已发出网络请求 |
| `stream.error` | SDK 流错误，包括可恢复的工具错误，不代表整轮必然失败 |
| `stream.protocol_error` | UI 消息流归并协议错误 |
| `generation.exception` | 准备或消费生成时抛出的异常 |
| `generation.initialization_error` | 外层生成失败处理路径 |

`durationMs` 为对应操作耗时；`budgetElapsedMs` 为从首次联网开始的累计时间，包含模型思考。`budgetReason` 为 `attempts`、`deadline` 或 `content`，多个条件同时满足时按代码优先级返回一个。HTTP 状态仅在错误提供时记录，不人为填 500。错误码保留既有来源的大小写约定。

同一个问题可能产生一条供应商失败和一条工具失败：前者是具体上游尝试，后者是模型最终收到的结果。备用成功时仍可存在主供应商失败日志。流回调对同一错误对象去重。

本改动仅补诊断，不修改联网预算、模型参数或失败恢复策略，不修复 #135/#136 尚未确认的根因。无法补回历史未记录的日志。

## Axiom

Axiom 是可选 transport，不替代 stdout。配置完整后，每条已经过上述脱敏规则处理的诊断事件会继续写 VPS stdout，同时异步批量发送到 Axiom；Axiom 不可用或 ingest 失败不会影响聊天请求。

生产环境配置：

```bash
AXIOM_TOKEN=<server-only ingest API token>
AXIOM_DATASET=thread-chat-production
AXIOM_EDGE_URL=https://eu-central-1.aws.edge.axiom.co
```

`AXIOM_EDGE_URL` 使用 Axiom Settings > General 对应 edge deployment 的完整 URL。三个变量缺任意一个都会安全降级为仅 stdout。不要使用 `NEXT_PUBLIC_` 变量，也不要把 token 写入客户端代码。

Axiom 事件额外包含 `timestamp`、`service=thread-chat`、`environment` 和 `release`。核心检索字段仍是 `event`、`requestId`、`threadId`、`assistantMessageId`、`toolCallId`、`modelId`、`provider`、`sessionId`、`traceId`。可以用 `traceId` 回到 Langfuse 查看同一条 AI 回复。

推荐先建立三个查询/看板：按 `event` 聚合失败数；按 `modelId/provider` 聚合失败率；按 `traceId/requestId` 查看单次故障链路。

## 验证

```bash
node --import tsx e2e/observability/production-diagnostics.test.mjs
node --import tsx e2e/observability/axiom-log.test.mjs
```

覆盖生产环境 429、并发 Session/Trace 隔离、预算拦截、敏感内容不进入日志，以及 Axiom 配置、批量 ingest、环境/release 元数据和未配置时安全降级。远端 Langfuse 与真实 Axiom 上报仍需在配置凭据的部署环境中核验。
