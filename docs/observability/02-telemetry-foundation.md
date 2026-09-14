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

`AI_TELEMETRY_RECORD_CONTENT` 在所有环境使用同一语义：设为 `true` 时记录模型输入与输出，设为 `false` 时只记录模型/用途、允许的关联 ID、环境、release、时序、usage 和安全错误信息。内容出口只按字段名清洗 `authorization`、`cookie`、`apiKey`、`secret`、`password`、`token` 和 `credentials`；其他内容不做关键词扫描或 URL 改写。

Langfuse 凭据缺失、初始化失败或 exporter 暂时不可用时，Agent 请求继续执行，现有 `[model-call]` 结构摘要日志仍然保留。摘要不包含 prompt/output 原文。

## 关联 ID 与隐私边界

- assistant Message Trace ID 由 `thread-chat:{assistantMessageId}` 确定性派生。
- legacy `/api/chat` Trace ID 由 request ID 派生。
- feedback Score ID 由 `user-feedback:{messageId}` 派生，可安全重放。
- 用户 ID 只允许通过 `AI_OBSERVABILITY_ID_SALT` 做 HMAC 后发送；出口会清洗明确的凭据字段，但保留邮箱、手机号、完整 query/URL、附件/网页正文、provider payload 和 reasoning，以支持线上诊断与评测。

运行底座合同测试：`pnpm test:observability:foundation`。
