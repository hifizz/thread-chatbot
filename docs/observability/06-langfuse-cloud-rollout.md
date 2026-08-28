# Langfuse Cloud 渐进发布

本章是操作员 Gate，不以“代码已合并”代替真实 Cloud、staging 或 production 验收。首阶段使用独立的 Langfuse Cloud Hobby project；以后迁移到 Langfuse OSS 时只替换 endpoint/key，不改 Agent 编排、Trace seed、Message schema 或反馈事实源。

## 1. Cloud 项目与 server-only secrets

1. 在离 VPS 较近且满足数据要求的 Langfuse Cloud region 创建独立 project。不要复用个人测试 project。
2. 在 Coolify 的 server-side secret store 配置 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、region 对应的 `LANGFUSE_BASE_URL` 和高熵 `AI_OBSERVABILITY_ID_SALT`。不要使用 `NEXT_PUBLIC_` 前缀。
3. 将 `AI_OBSERVABILITY_ENVIRONMENT=staging`、`AI_OBSERVABILITY_RELEASE=<git-sha-or-image-tag>`、`AI_TELEMETRY_RECORD_CONTENT=false`、`AI_DEVTOOLS_ENABLED=false` 固定到 staging。
4. 初次部署设置 `AI_TELEMETRY_ENABLED=false` 和 `AI_LANGFUSE_ENABLED=false`。在部署环境执行 `pnpm observability:check-release`；此时总开关/remote export 的 warning 是预期的，任何 fail 必须先修复。

Cloud project、region、key 写入时间和操作员只记录在私有运维系统，不提交到仓库。

## 2. Staging 场景验收

先开启 `AI_TELEMETRY_ENABLED=true`、`AI_LANGFUSE_ENABLED=true`，保持 metadata-only。逐一运行并在 Langfuse 核对：

| 场景          | 必须看到                                             | 不得看到                 |
| ------------- | ---------------------------------------------------- | ------------------------ |
| 普通回答      | 单一 Message Trace、model step、usage、completed     | prompt/output 正文       |
| research      | route、plan、answer 父子关系                         | 完整 query               |
| Search/Fetch  | 每个 provider attempt、outcome、域名、usage unit     | URL query、网页正文、key |
| Artifact/tool | 同一根 Trace 下的 tool step                          | 附件正文、隐藏推理       |
| Stop/失败     | stopped/failed、错误类别、数据库终态后结束           | 原始 provider error body |
| Retry/replay  | Retry 新 Message 新 Trace；同 Message replay 稳定 ID | 重复 generation 实体     |
| feedback      | 同 Trace 的 `product-feedback`，up/down/cleared 覆盖 | 用户身份或反馈正文       |

把无敏感内容的 Trace URL、release、场景、时间和检查人填入 `docs/observability/evidence/langfuse-rollout-template.md` 的私有副本；不要提交包含线上 ID 的证据。

## 3. 故障演练

在 staging 依次使用不可达 endpoint、无效 key（401）、受控速率限制/429、网络超时和进程退出前 flush 失败。每轮确认：

- HTTP/Agent 响应不依赖 exporter；后台生成仍到达数据库 completed/stopped/failed 终态。
- feedback 数据库事务仍成功，远端失败只产生安全错误类别；修复后可重复 backfill。
- 日志没有 key、Authorization、Cookie、prompt/output 或原始 provider body。
- `AI_TELEMETRY_ENABLED=false` 可一键停止所有 telemetry；若只停远程出口，设置 `AI_LANGFUSE_ENABLED=false`。

SDK fake 故障测试只能证明代码降级合同，不能替代这一轮真实 staging 网络演练。

## 4. Units 与保留期决策

在至少 30 个代表性 Agent run 后记录：总 units、run 数、units/run 平均值与 p95、每日 ingestion、Search/research 占比、所需历史窗口、项目成员数。每周推算：

```text
projected_monthly_units = daily_runs × p95_units_per_run × 30
```

当预测接近当前 Hobby 套餐的 50k units/月、30 天历史或 2 用户边界时，不要静默丢数据；在以下方案中记录选择与回滚：缩小非关键 span、降低非错误生产采样、缩短 scheduled eval、付费升级，或迁移 Langfuse OSS。套餐边界会变化，上线前以 Langfuse 当前官方定价为准。

## 5. Production 渐进开启与回滚

1. 部署代码但保持 telemetry 总开关关闭，核对应用健康和无 DevTools。
2. 对内部/低流量 cohort 开启 metadata-only，记录 release 与起止时间。
3. 核对至少一个普通回答、Search、Stop/失败和 feedback，再扩大到低流量全量。
4. 观察 exporter 延迟/错误、Agent p95、units/run 和日志泄漏；任何产品状态异常立即 `AI_TELEMETRY_ENABLED=false` 回滚。
5. 生产默认永远 metadata-only。内容评测使用隔离的 `evaluation` 环境、合成/授权 case，不用生产用户身份。

迁移 OSS 时先在非生产把 `LANGFUSE_BASE_URL` 换成 HTTPS OSS endpoint，运行配置检查和全场景验收。稳定 Trace/Score ID 让两边可以对照，但历史数据迁移是独立运维工作，不能靠改 endpoint 自动完成。
