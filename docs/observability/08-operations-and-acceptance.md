# Agent 可观测性与评测操作手册

这套能力把同一次 assistant Message 的后台生成、AI SDK 模型 step、工具、Search provider attempt、checkpoint、终态和产品反馈关联为稳定 Trace；本地用 AI SDK DevTools 看实时过程，staging/production 用 Langfuse 看跨发布历史，仓库评测用稳定 case 和配置指纹比较候选版本。

## 1. 完成后能看到什么

| 使用面      | 能力                                                                                                 | 事实源与边界                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 本地调试    | AI SDK DevTools 查看模型 step、工具调用和流式生成                                                    | 只在 development 显式开启；production 有硬保护                                    |
| 线上观测    | Langfuse 按 release、Project session、Thread、匿名用户、终态、错误和 usage 检索完整 Trace 树         | production 默认 metadata-only，不记录 prompt/output 正文                          |
| Search 诊断 | 查看 route reason、provider、attempt/fallback、duration、usage unit 与安全错误类别                   | 只保留 query fingerprint 和域名，不保留完整 query/URL/正文                        |
| 用户反馈    | up/down/cleared 以确定性 Score ID 镜像到对应 Message Trace                                           | 产品数据库始终是事实源；Langfuse 是最终一致的分析副本                             |
| 持续评测    | 比较 prompt、model、Search policy/provider、memory、toolset 和 multimodal parser 的 case-level delta | repo case/revision 是可复现事实源；Langfuse Dataset/Experiment 是远端镜像与分析面 |

## 2. 本地观察 Agent

在 `.env.local` 保留 application/database/model 的原有配置，再设置：

```dotenv
AI_TELEMETRY_ENABLED=true
AI_DEVTOOLS_ENABLED=true
AI_LANGFUSE_ENABLED=false
AI_OBSERVABILITY_ENVIRONMENT=development
AI_TELEMETRY_RECORD_CONTENT=true
```

用两个终端启动应用和 viewer：

```bash
pnpm dev
pnpm observability:devtools
```

发起普通回答、研究请求或 Search/Fetch 后，在 DevTools 中核对同一请求下的 model step 与 tool step。开发环境允许内容是为了本机调试；共享机器仍应把 `AI_TELEMETRY_RECORD_CONTENT=false`。DevTools 不替代 Langfuse 的跨进程历史，也不应暴露到 VPS。

## 3. 接入 Langfuse Cloud 与 VPS

先创建独立 Cloud project，把 public key、secret key、region endpoint 和匿名 salt 放入 Coolify/VPS server-side secret store；不要使用 `NEXT_PUBLIC_`：

```dotenv
AI_TELEMETRY_ENABLED=true
AI_LANGFUSE_ENABLED=true
AI_DEVTOOLS_ENABLED=false
AI_OBSERVABILITY_ENVIRONMENT=staging
AI_OBSERVABILITY_RELEASE=<git-sha-or-image-tag>
AI_TELEMETRY_RECORD_CONTENT=false
LANGFUSE_PUBLIC_KEY=<server-secret>
LANGFUSE_SECRET_KEY=<server-secret>
LANGFUSE_BASE_URL=<region-endpoint>
AI_OBSERVABILITY_ID_SALT=<high-entropy-server-secret>
```

部署前运行：

```bash
pnpm observability:check-release
```

然后按 [Langfuse Cloud 渐进发布](./06-langfuse-cloud-rollout.md) 从 staging metadata-only、小流量 production 到全量逐 Gate 验证。Cloud 不可达或配置缺失只降低观测能力，不能改变 Agent 响应、Message 数据库终态或 feedback 保存。迁移 Langfuse OSS 时替换 endpoint/key 并重跑 Gate，不改 Agent 编排和数据模型。

## 4. 怎么测试

纯本地、无模型/网络/数据库的完整合同测试：

```bash
pnpm test:observability
pnpm test:agent-evals
```

快速评测和候选比较：

```bash
pnpm eval:agent
pnpm eval:agent:ci -- --write-snapshot=evals/agent/results/local/candidate.json
pnpm eval:agent:compare -- \
  --baseline=evals/agent/baselines/fixture-v1.json \
  --candidate=evals/agent/results/local/candidate.json
```

真实模型/工具内容评测必须使用 `evaluation` 环境和 `--executor=declared`；真实生命周期评测还必须使用独立 `EVAL_DATABASE_URL`，database 名匹配 `thread_chat_eval[_suffix]`，显式设置 `EVAL_ALLOW_DATABASE_WRITES=true`，并使 `EVAL_DATABASE_GUARD_TOKEN` 与 PostgreSQL 库级 `thread_chat.evaluation_guard` setting 一致。安全检查会在首次写入前拒绝 production DB。详细参数见 [Agent eval README](../../evals/agent/README.md)。

Langfuse Dataset 同步默认 dry-run；确认差异后才执行，并可把同一次 run 记录为 Experiment：

```bash
AI_OBSERVABILITY_ENVIRONMENT=evaluation pnpm eval:agent:sync
AI_OBSERVABILITY_ENVIRONMENT=evaluation pnpm eval:agent:sync -- --execute
AI_OBSERVABILITY_ENVIRONMENT=evaluation \
  pnpm eval:agent:release -- --executor=declared --langfuse-experiment
```

代码级测试不能替代两项人工验收：实际打开 DevTools 查看普通回答/多步工具，以及在 Langfuse staging 查看 metadata-only Trace、feedback Score、Experiment 与无敏感数据。数据库 Gate 也必须由专用测试数据库执行。

## 5. Loop Engineering 日常循环

1. 在 Langfuse 按 release、failed/stopped、Search fallback、p95/usage 或 `product-feedback=down` 找问题。
2. 经授权查看原 Trace，只提取最小必要事实；用合成文本、公开来源或重新制作的 fixture 替代用户内容。
3. 新建稳定 case ID，先证明旧 baseline 能复现问题；敏感 case 标 `authorized-private`，默认不上传。
4. 运行 fixture smoke，再用与 baseline 相同的 case IDs 跑真实 baseline/candidate Experiment。
5. 查看分项 hard failure、route/tool、Search、memory/no-leak、multimodal grounding、judge、latency/usage delta，不依赖一个总分。
6. 修复后保留 candidate fingerprint、比较报告、Experiment URL 和回滚版本；staging 渐进验证后发布。
7. 把这个 case 留在 CI/scheduled suite，线上再次观察相同 error/feedback 信号，形成下一轮输入。

完整的策展、CI override、scheduled/release 与额度调整规则见 [Agent Loop Engineering](./07-loop-engineering.md)。PR 只由稳定的确定性 hard failure 阻断；live Web 和模型裁判是波动维度，必须单独展示。

## 6. 当前本地验收（2026-08-28）

- 已通过全部 observability/privacy/Trace/provider-attempt/feedback/eval 合同测试。
- 已通过无数据库依赖的 Thread Chat session、UI pipeline、API contract 和 client store Gate。
- 已通过 fixture smoke、baseline snapshot 和 candidate comparison；这些结果不冒充真实模型或 Langfuse Cloud Experiment。
- `pnpm typecheck` 通过；`pnpm lint` 通过且只有 `app/layout.tsx`、`lib/auth/session-recovery.ts` 两条实施前已存在的 warning。
- 默认 Turbopack build 因当前执行环境禁止 PostCSS 子进程绑定内部端口而退出；webpack 复查则只因 Google Fonts TLS 下载失败而退出。两项均与实施前环境基线一致，普通 CI/VPS 仍必须重跑 `pnpm build`。
- `DATABASE_URL`、`DIRECT_URL`、`EVAL_DATABASE_URL` 当前未配置，因此数据库、真实 lifecycle 与 cutover Gate 未执行，禁止临时借用 production DB。
- Langfuse Cloud project、staging/VPS secrets、真实 Trace/Score/Experiment 及 production 渐进发布仍是操作员 Gate。

在上述外部门禁完成前，OpenSpec change 保持未完成；不要仅凭本地 fake integration 将其归档。
