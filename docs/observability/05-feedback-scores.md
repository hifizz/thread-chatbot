# Feedback Score 镜像

产品数据库仍是用户反馈唯一事实源。`up`、`down` 或清除操作先在现有事务中提交；HTTP 成功只表示数据库写入成功，不表示 Langfuse 已经同步。

事务返回后，route 通过 Next.js `after()` 注册异步镜像。每个 assistant Message 使用固定的 Trace ID 和固定的 `product-feedback` Score ID：再次提交、up/down 互换和清除都会写入同一个远端逻辑 Score。清除用 categorical `cleared` 表示，以免远端还显示过期的 up/down。Score 先于 Trace 到达是允许的，之后会由相同 Trace ID 关联。

Langfuse 未启用、不可达、超时或 SDK 初始化失败时，反馈 API 和数据库状态不受影响。服务端只记录安全的事件名与错误类别，不记录反馈关联的用户内容。Langfuse SDK 自身批量 ingestion 的远程拒绝仍应在 Langfuse/服务日志中诊断；这里不承诺外部 Score 强一致。

## 回填

脚本默认 dry-run，只读取 assistant Message 中当前非空反馈，计算确定性 Trace/Score ID 并输出数量与最多五个样例：

```bash
pnpm observability:feedback:backfill
```

核对环境、数据库和 Langfuse server-only 凭据后执行：

```bash
pnpm observability:feedback:backfill -- --execute --batch-size=100
```

脚本按 Message ID 分批读取，逐项排队，并在结束前做一次 final flush。重复执行使用相同 Score ID，不会创造第二个当前逻辑评分。数据库中已经清除为 `null` 的历史反馈没有可恢复事件，因此普通 backfill 不会为它们补 `cleared`；在线清除操作会实时镜像 `cleared`。

失败时先确认 `AI_TELEMETRY_ENABLED`、`AI_LANGFUSE_ENABLED`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 和 `LANGFUSE_BASE_URL`，再 dry-run 核对目标数据，修复后重复执行即可。不要把 key 放入命令行、客户端环境变量或日志。
