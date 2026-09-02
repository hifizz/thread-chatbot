# 遥测底座与本地 DevTools

## 本地查看 Agent 过程

1. 从 `.env.example` 复制并保留以下本地默认值：

   ```dotenv
   AI_TELEMETRY_ENABLED=true
   AI_DEVTOOLS_ENABLED=true
   AI_TELEMETRY_RECORD_CONTENT=true
   AI_OBSERVABILITY_ENVIRONMENT=development
   AI_LANGFUSE_ENABLED=false
   ```

2. 运行应用：`pnpm dev`。
3. 在另一个终端运行查看器：`pnpm observability:devtools`。
4. 发起普通回答、Search 或工具调用。查看器会读取 `.devtools/` 中的本地运行记录。

`.devtools/` 可能包含完整开发 prompt/output，已被 Git 忽略。只使用合成或可公开的开发数据，不要共享该目录。生产环境在代码中强制禁用 DevTools，即使误设 `AI_DEVTOOLS_ENABLED=true` 也不会初始化。

## Langfuse Cloud / OSS

生产或 staging 设置 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 和对应 region 的 `LANGFUSE_BASE_URL`。`AI_TELEMETRY_ENABLED=false` 是总回滚开关；本地如需联调 Langfuse，另设 `AI_LANGFUSE_ENABLED=true`。

生产默认只导出模型/用途、允许的关联 ID、环境、release、时序、usage 和安全错误信息。`AI_TELEMETRY_RECORD_CONTENT=true` 在 production 也不会单独开启正文，必须由调用侧同时判定受控 cohort。evaluation 和 staging 可显式开启批准 fixture 的正文，但仍会经过统一 exporter mask。

Langfuse 凭据缺失、初始化失败或 exporter 暂时不可用时，Agent 请求继续执行，现有 `[model-call]` 结构摘要日志仍然保留。摘要不包含 prompt/output 原文。

## 关联 ID 与隐私边界

- assistant Message Trace ID 由 `thread-chat:{assistantMessageId}` 确定性派生。
- legacy `/api/chat` Trace ID 由 request ID 派生。
- feedback Score ID 由 `user-feedback:{messageId}` 派生，可安全重放。
- 用户 ID 只允许通过 `AI_OBSERVABILITY_ID_SALT` 做 HMAC 后发送；邮箱、手机号、认证信息、完整 query/URL、附件/网页正文、provider payload 和隐藏推理会在出口再次脱敏。

运行底座合同测试：`pnpm test:observability:foundation`。
