# Issue #34 Conversation cutover runbook

## 前置状态

依赖链五个 changes 的任务均已完成：

```text
define-conversation-domain-model
  → normalize-conversation-persistence
  → migrate-generation-lifecycle
  → add-conversation-command-api
  → normalize-conversation-client-state
```

`pnpm openspec:validate` 当前为 31/31。正式环境仍须填写负责人、观察窗口、性能/错误/计费基线和真实备份 ID；本文件中的本地结果不能替代生产批准。

## 部署迁移边界

- Vercel Preview 默认只构建，不在共享数据库执行迁移。多个功能分支不能争用同一份 Drizzle 迁移日志。
- 只有 Preview 使用独立、可丢弃的数据库时，才可显式设置 `VERCEL_PREVIEW_DATABASE_MIGRATIONS=true`。
- Production 迁移继续失败即阻断，并在执行 DDL 前校验本地迁移的时间戳与哈希。出现旧谱系、缺失迁移或哈希分叉时必须人工核对，禁止自动覆盖迁移日志。
- Issue #34 正式切换前，必须把目标库的旧迁移谱系核对和基线处置记录到环境 ADR；Preview 构建通过不代表该门禁已完成。

## Release 行为矩阵

| 行为边界                                   | 自动证据                              | Ego Browser / API smoke                 | Cutover 门禁                          |
| ------------------------------------------ | ------------------------------------- | --------------------------------------- | ------------------------------------- |
| owner/workspace/project 隔离               | persistence、command API DB tests     | 已登录测试账号读取规范 Conversation     | 越权统一不可见；无跨 owner 引用       |
| Conversation 列表/创建/标题/归档/恢复/删除 | command contract/API、client tests    | 列表、重命名、归档/恢复已验证           | revision 与幂等键稳定                 |
| Thread 标题/归档/恢复                      | command API、client tests             | 三列 A→B→C、最深 Thread 归档/恢复       | 根 Thread 不可被错误归档或重挂        |
| Fork/selection/A→B→C                       | domain、persistence、client tests     | 列/树列表/画布均显示 3 节点 2 边        | 来源 Message 精确且图无环             |
| send/edit/regenerate/select variant        | generation、command、client tests     | GLM 5.3 流式、刷新、变体选择已验证      | current Generation 每 Turn 唯一       |
| Markdown/研究/Artifact                     | generation checkpoint、client tests   | Markdown/结构化研究与 Artifact 定位     | Artifact 来源是稳定 Thread/Message ID |
| copy/feedback/actions                      | client 与 feedback DB tests           | 复制状态、赞/踩刷新保持                 | feedback 使用稳定 Message ID          |
| disconnect/Stop/stale/refresh              | generation unit/DB、coordinator tests | partial Stop 与刷新恢复已验证           | 非终态与 pending billing 必须清零     |
| usage/exactly-once billing                 | generation DB tests                   | 不依赖浏览器连接                        | pending billing=0；usage 终态明确     |
| authority 与旧协议                         | authority/client tests                | authority 三元组匹配；旧 route 返回 410 | 不存在分裂开关或 fallback             |

## 版本化 release manifest

正式演练和 cutover 必须先生成受版本控制的 JSON manifest，并用 `pnpm validate:conversation-cutover-manifest -- --manifest-file <manifest.json> --for-execution --environment <env> --database-host <host> --database-name <name>` 校验。manifest 固化负责人、维护/观察窗口、实测基线、阈值、import/reset ADR、legacy/canonical 备份恢复证明、epoch 和十项 go/no-go 结果，并输出稳定 SHA-256 供审批与执行日志引用。

schema-only 校验不代表可执行；`--for-execution` 会在任一门禁为 false、环境/数据库漂移、窗口过期、备份验证晚于维护开始，或“有保留义务却选择 reset”时 fail closed。仓库不提供带伪造生产值的默认 manifest。

## 本地 cutover 演练结果（2026-08-22）

- 数据：19 棵 legacy 树；22 Thread、34 Turn、71 Message、3 Fork、37 Generation、1 feedback。
- 审计：15 棵直接可迁移；4 棵共 5 条 `generation_intent_missing`；0 条拒绝级污染。
- drain：legacy/canonical active Generation、pending billing、canonical outbox 五项均为 0。
- 导入：19 个 Conversation、187 个实体；同事务逐 Conversation 写入、post-import verifier、重复导入幂等检查全部通过，随后强制回滚。
- 回滚证明：`legacy_conversation_entity_mappings=0`，`conversations.id LIKE 'legacy:%'=0`。
- 客户端：`canonical / schema 1 / local-issue34-20260822` 匹配后正常加载；旧 tree 与 generation routes 返回 410。
- 备份恢复：通过受限临时数据库完成 legacy dump→恢复→drain/审计→正式导入两次→canonical dump→再次恢复；两次恢复的 13 张 cutover 表指纹均与备份源一致，耗时约 8.4 秒，临时数据库与文件均已删除。

## 正式 go / no-go checklist

- [ ] 目标环境重新执行只读审计，保存完整报告与 plan hash。
- [ ] 确认所有 repair/排除项均在目标环境 ADR 中获批。
- [ ] 记录负责人、值班人、维护窗口、观察窗口和回滚决策人。
- [ ] 记录容量、P95/P99、命令错误率、Generation age、Stop latency、计费差异基线和阈值。
- [ ] 创建 legacy 与 canonical 备份，执行真实恢复验证并填写备份 ID。
- [ ] 进入 `legacy + read-only`，运行 drain checker 直至 `ready=true`。
- [ ] 用目标审批文件执行 import/reset，保存 verifier 结果。

受批准 reset 必须同时提供 ADR 审批文件与独立的备份恢复验证文件，并设置与二者精确匹配的 `CONVERSATION_CUTOVER_ENVIRONMENT`、`CONVERSATION_CUTOVER_APPROVAL_ID`、`CONVERSATION_CUTOVER_BACKUP_ID`。只有在 `legacy + read-only`、drain 清零且 `CONVERSATION_APPROVED_RESET_ENABLED=true` 时，才可运行 `pnpm reset:approved-conversations -- --execute --approval-file <adr.json> --backup-verification-file <backup.json>`。先用 `--test-rollback` 完成同一事务路径的强制回滚验证。工具保留 `usage_records`，任何财务账本处置必须走独立 ADR。

本地临时库演练已覆盖完整 reset SQL：在 canonical 备份恢复副本中删除审批 scope 内实体后强制回滚，13 张 cutover 表的合并指纹在前后完全一致，并验证关联的 5 条 `usage_records` 未被删除。该证据只证明工具路径，不构成目标环境的数据丢弃批准。

## 回滚边界：首个 canonical 写入是不可逆时刻

用 `pnpm plan:conversation-forward-recovery -- --request-file <incident.json>` 生成只读恢复计划。首个 canonical 写入之前，只能在确认 canonical 写入仍为零后中止 cutover 并回到 `legacy + read-only`；首个 canonical 写入之后，规划器会拒绝 legacy authority、`canonical → legacy` 同步和 legacy 备份，只允许保持 canonical authority、进入 read-only、恢复已验证的 canonical 备份或部署前滚修复，并使用新 epoch 恢复流量。

该规划器不直接修改部署或数据库；目标环境仍需把 incident、批准、首写时间、备份恢复证明、执行日志和 smoke 结果放入证据包。

- [ ] 原子切换 canonical server/client epoch，运行行为矩阵关键 smoke。
- [ ] 确认首个 canonical 生产写入时间；此后禁止恢复落后的 legacy 权威。
- [ ] 观察期内 legacy route/query 为 0，完整性与计费对账连续通过。
