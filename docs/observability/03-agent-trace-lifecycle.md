# Agent Trace 生命周期

## 规范化 Thread Chat

每个 assistant Message 对应一个稳定 Trace：

```text
sessionId = projectId
traceId   = createTraceId("thread-chat:" + assistantMessageId)

thread-chat.generation
├── research.route
├── research.plan（仅 research）
├── AI SDK model / step / tool observations
├── persistence.checkpoint
└── generation.finalize
```

根 Trace 在确认 owner-scoped Message 与 Thread 后启动，并覆盖模型上下文编译、研究决策、流消费、checkpoint 和数据库 finalize。浏览器刷新、SSE 断开或没有订阅者都不会结束后台任务；只有数据库终态已经确定、Session 收到 terminal 后，根 Trace 才会结束。

Retry/Regenerate 创建新的 assistant Message，因此产生新的 Trace。相同 command replay 或相同 Message 的后台重放使用相同确定性 Trace ID；SessionStore 仍负责防止同进程重复启动模型 pipeline。

## Trace metadata

允许进入根 Trace 和 AI SDK runtime context 的字段由 allowlist 管理：Project、Thread、assistant Message、模型、环境、release、匿名用户和 prompt/Search/memory/toolset/multimodal parser 版本。用户 ID 仅在配置 HMAC salt 后以匿名值出现；未配置时宁可不导出用户维度。

checkpoint 只记录调度次数、写入次数、parts 数和序列化字节数。finalize 只记录请求/最终状态、finish reason、parts 数和 provider usage 是否存在。不会把 UI chunks、附件正文、页面正文或隐藏推理写成事件。

## 终态与异常

- `completed`：数据库成功提交完成态后记录。
- `stopped`：用户 Stop 或 SDK abort，保留已有 parts，不标为错误。
- `failed`：模型、协议、初始化或空响应失败，记录安全错误类别，不记录 provider 原始 payload。
- 进程重启：启动时的 reconciliation 先把遗留 `generating` Message 收敛为 `PROCESS_RESTARTED`，随后以同一 Message 派生的 Trace ID 补记失败结果。遥测失败不会回滚数据库终态。

过渡期 `/api/chat` 使用 request ID 派生根 Trace，并标记 `legacy-chat`。AI SDK 调用在该 active context 内创建；server-owned `after(consumeStream)` 负责记录消费结果并结束根 Trace。

## 合同测试

- `pnpm test:observability:trace`：内存 tracing backend 验证 Trace 树、父子关系、确定性身份、AI SDK lifecycle、usage、错误分类和 SSE 断开后的后台终态。
- `pnpm test:thread-chat:gate2-session`：重复 start 与 subscriber 断开不会重复或取消后台任务。
- 数据库 Gate 2：在隔离测试库中验证 checkpoint、completed/stopped/failed、进程重启收敛和 finalize CAS。
