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

## 验证

`node --import tsx e2e/observability/production-diagnostics.test.mjs`

覆盖生产环境 429、并发 Session/Trace 隔离、预算拦截、敏感内容不进入日志；另运行已有供应商、Trace 和 UI 消息流测试。远端 Langfuse 与线上部署需在配置凭据的环境中核验。
