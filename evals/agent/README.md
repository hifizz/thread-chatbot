# Thread Chat Agent evals

仓库 case 是可复现事实源；Langfuse Dataset 是带稳定 item ID 的远端镜像，不以其“最新版本”替代 Git revision。每次 run 都记录完整 candidate fingerprint、dataset revision、case-level Trace ID、输出、usage、attempt、终态和分项 score。

## 本地使用

默认只跑 fixture smoke，不访问模型、网络、Langfuse 或数据库：

```bash
pnpm eval:agent
pnpm eval:agent:ci -- --suite=search-routing --tag=smoke
pnpm eval:agent -- --case=foundation-local-answer
```

执行 case 声明的 production content/lifecycle adapter 必须显式加 `--executor=declared`。content adapter 复用 production `prepareGeneration`（路由、prompt、工具与 streamText）；lifecycle adapter 在隔离数据库创建 Project/Thread/Message，运行真实 `runGeneration`，读取终态后级联清理测试用户。

```bash
AI_OBSERVABILITY_ENVIRONMENT=evaluation \
  pnpm eval:agent -- --executor=declared --suite=core-answer
```

lifecycle 还要求 database 名匹配 `thread_chat_eval[_suffix]`、与规范化后的 `DATABASE_URL` 不同，并显式设置 `EVAL_ALLOW_DATABASE_WRITES=true`。运行前需在 Evaluation PostgreSQL 库执行 `ALTER DATABASE thread_chat_eval SET thread_chat.evaluation_guard = '<24+字符随机值>';`，重连后将同一值配置为 `EVAL_DATABASE_GUARD_TOKEN`。应在全新进程运行 lifecycle suite；URL 别名、严格命名和库内 guard 任一不通过都会在首次写入前终止。

## Langfuse

Dataset 同步默认 dry-run；核对后才执行：

```bash
AI_OBSERVABILITY_ENVIRONMENT=evaluation pnpm eval:agent:sync
AI_OBSERVABILITY_ENVIRONMENT=evaluation pnpm eval:agent:sync -- --execute
```

`authorized-private` case 默认不上传 Dataset 或 Experiment。仅在同时传入 `--include-authorized-private` 且设置 `EVAL_ALLOW_PRIVATE_REMOTE=true` 时才允许。Experiment 使用 `--langfuse-experiment`，结束或异常都会 final flush。evaluation 的 case/candidate identity 与 production user/session 隔离。

可选模型裁判用 `--judge-model=<registered-model-id>` 开启，只增加 correctness、faithfulness、helpfulness、completeness 和 citation support 五个独立分数。judge model 与 rubric version 会写入 evaluator version；它不能覆盖 deterministic hard failure。`fixtures/judge-calibration.json` 是合成人工标签校准小集，调整 judge/rubric 时应更新并复核 MAE。

## Case 约定

- `id` 一旦进入 baseline 不得复用为不同问题；内容语义大改应创建新 ID。
- `sensitivity` 必须为 synthetic、public 或 authorized-private。
- fixture path 被限制在 `evals/agent/fixtures/`。
- 不把多个维度压成单一总分；确定性安全/状态失败优先显示。
- live Web、模型裁判和生产回流都必须单独标记，不伪装成稳定 deterministic case。
