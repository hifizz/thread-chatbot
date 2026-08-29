# Feedback Score 镜像

产品数据库仍是用户反馈唯一事实源。`up`、`down` 或清除操作先在现有事务中提交；HTTP 成功只表示数据库写入成功，不表示 Langfuse 已经同步。

同一事务还会 upsert `feedback_score_outbox`，以单调 `version` 保存最新投递状态。事务返回后，route 通过 Next.js `after()` 唤醒 drain。每个 assistant Message 使用固定的 Trace ID 和固定的 `product-feedback` Score ID：再次提交、up/down 互换和清除都会写入同一个远端逻辑 Score。清除用 categorical `cleared` 表示，以免远端还显示过期的 up/down。Score 先于 Trace 到达是允许的，之后会由相同 Trace ID 关联。

Langfuse 未启用、不可达、超时或 SDK 初始化失败时，反馈 API 和数据库状态不受影响。失败任务保留 attempts、next-at 和安全错误类别；数据库租约允许多个实例使用 `SKIP LOCKED` 并发 drain，且旧版本不能确认投递期间产生的新版本。服务端不记录反馈关联的用户内容。

VPS/生产环境应每分钟执行一次持久化 drain（可用 cron、systemd timer 或部署平台 scheduler）：

```bash
pnpm exec tsx scripts/drain-feedback-score-outbox.ts --batch-size=25 --max-batches=100
```

命令可重复运行；未到重试时间、仍在有效租约内或已经确认的行不会被领取。进程在远端调用前后退出时，其他实例会在租约过期后重新领取。

## 回填

脚本默认 dry-run，只读取 assistant Message 中当前非空反馈，计算确定性 Trace/Score ID 并输出数量与最多五个样例：

```bash
pnpm observability:feedback:backfill
```

核对环境、数据库和 Langfuse server-only 凭据后执行：

```bash
pnpm observability:feedback:backfill -- --execute --batch-size=100
```

脚本按 Message ID 分批读取，逐项排队，并在结束前做一次 final flush。重复执行使用相同 Score ID，不会创造第二个当前逻辑评分。数据库中已经清除为 `null` 且发生在 outbox 迁移前的历史反馈没有可恢复事件，因此普通 backfill 不会为它们补 `cleared`；迁移后的在线清除会持久化为 outbox 的 `cleared`。

失败时先确认 `AI_TELEMETRY_ENABLED`、`AI_LANGFUSE_ENABLED`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 和 `LANGFUSE_BASE_URL`，再 dry-run 核对目标数据，修复后重复执行即可。不要把 key 放入命令行、客户端环境变量或日志。
