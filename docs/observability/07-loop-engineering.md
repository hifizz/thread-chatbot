# Agent Loop Engineering

目标不是建立一次性 dashboard，而是把线上信号持续转化为可复现 case，再用同一组 case 比较 prompt、model、Search provider/policy、记忆、工具和多模态解析器。

```text
production Trace / error / down feedback
  -> 授权复盘与最小化
  -> 合成或公开 fixture + 稳定 case ID
  -> fixture smoke / live baseline
  -> candidate experiment + 分项 delta
  -> 修复、发布、渐进放量
  -> 新 production signal
```

## 1. 生产信号策展

1. 在 Langfuse 按 release、error category、Search outcome、latency、usage 和 `product-feedback=down` 找候选。反馈 Score 只是独立信号，不代表自动质量标签。
2. 只有获得授权的操作员可以查看原 Trace；记录问题类别和最小必要事实，不复制完整 prompt/output、用户 ID、附件、网页正文或隐藏推理。
3. 优先用合成文本、公开 URL 和重新制作的 fixture 复现。必须保留真实片段时，先去身份化、移除 secret/PII、缩短到必要范围，并标记 `authorized-private`；该 sensitivity 默认不会同步 Langfuse Dataset。
4. 新 case 使用新稳定 ID，写清 expected route/tool/terminal、hard safety 条件和可选 rubric。先让 case 在旧 baseline 上稳定复现问题，避免只为当前修复写“必过”答案。
5. 在私有事件记录中保存原 Trace URL 与 repo case ID 的映射；仓库只提交脱敏 case，不提交生产 Trace ID。

## 2. 本地循环

```bash
pnpm eval:agent -- --case=<case-id>
pnpm eval:agent:ci -- --write-snapshot=evals/agent/results/local/candidate.json
pnpm eval:agent:compare -- \
  --baseline=evals/agent/baselines/fixture-v1.json \
  --candidate=evals/agent/results/local/candidate.json
```

默认 fixture smoke 很快且不花模型费用；需要验证 production route/prompt/tool core 时设置隔离的 `AI_OBSERVABILITY_ENVIRONMENT=evaluation` 并显式 `--executor=declared`。对 Search live Web 和可选 judge 的波动单独看，不把它们混成总分。

比较报告列出：配置 fingerprint 差异、suite/case hard failure、judge delta、p50/p95、usage、provider attempts/fallback、错误和空结果。PR 只由稳定 deterministic hard failure 阻断；阈值误报必须由代码所有者书面 override，并新建修正 case/阈值的后续任务，不能直接删失败。

## 3. CI、scheduled 与 release

- `agent-evals.yml` 对 Agent 相关 PR 运行 smoke+ci fixture、合同测试、baseline comparison，并保存 snapshot/report artifact。
- 仓库变量 `LANGFUSE_PR_EVAL_ENABLED=true` 时，额外用官方 Langfuse client 跑稳定 content subset；production secret、session 和 analytics identity 不参与。
- `agent-evals-scheduled.yml` 每周跑全部 fixture。手动勾选 live 后才运行更贵的 Search/记忆/多模态 Langfuse Experiment；生命周期数据库 suite 应在配置了专用 eval DB 的环境独立执行。
- release 前使用 `eval:agent:release`，保留 candidate fingerprint、Dataset revision、Langfuse Experiment URL、比较报告和 release/image tag。

所有 workflow 固定 `AI_OBSERVABILITY_ENVIRONMENT=evaluation`、关闭 DevTools，且 metadata-only。evaluation case/candidate 是身份；不得使用 production user/session/analytics ID。

## 4. Cloud units 与频率

每周把实际 units/run 平均值与 p95 写入 rollout evidence，按 `daily runs × p95 units/run × 30` 预测月量。接近套餐 units、保留期或成员边界时，按以下顺序评估：减少 scheduled case 频率、缩小非关键 span、只对稳定 subset 跑 judge、付费升级、迁移 OSS。任何 sampling/频率变化必须记录触发指标、旧/新值和回滚命令。

不要为了节省 units 删除安全/隐私 hard case；可减少的是远端 Trace 粒度或高波动/高成本的主观评测频率。

## 5. 首次真实闭环 Gate

当前提交包含 fixture baseline 和 CI 闭环，但不声称已有真实 Langfuse Experiment。Cloud/staging 可用后，用一个已知非敏感问题完成：定位 staging Trace → 制作脱敏 case → Dataset 幂等同步 → 保存 live baseline URL → candidate Experiment → 验证修复 → 记录回滚。完成后再勾选 OpenSpec 9.1/9.4，并把无敏感内容的证据放在私有运维记录。
