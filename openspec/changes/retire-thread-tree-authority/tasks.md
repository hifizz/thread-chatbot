## 1. 前置实现与发布门禁

- [x] 1.1 验证 `define-conversation-domain-model`、规范持久化、Generation lifecycle、命令 API 和 normalized client 的必需任务及 strict specs 全部完成。
- [x] 1.2 建立目标行为矩阵，关联认证、生命周期、列/画布、A → B → C Fork、变体、actions、Artifact/研究、Generation/计费的自动测试和 smoke。
- [ ] 1.3 记录当前容量/性能/错误/计费基线、cutover 阈值、负责人、观察窗口和 go/no-go checklist。
- [ ] 1.4 演练 canonical 备份恢复、维护模式、authority epoch mismatch 和切换后只读/前滚回滚流程。

## 2. 数据审计与处置 ADR

- [ ] 2.1 在目标环境运行只读 legacy 审计，输出所有者、Conversation/Thread/Message/Generation、标题、反馈、Artifact 和 usage 数量。
- [ ] 2.2 逐项处理或明确阻塞悬空、跨所有者、重复 ID、错误 Fork/active path 和计费引用。
- [ ] 2.3 基于保留义务形成“确定性导入或受批准重置”ADR，记录范围、理由、批准人、备份和排除项。
- [ ] 2.4 将 ADR 结果转成版本化 cutover 配置，不在代码中隐式猜测环境或数据处置方式。

## 3. 确定性导入或重置工具

- [x] 3.1 实现 `(legacyTreeId, entityType, localId) → canonicalId` 的持久映射与幂等 dry-run/report。
- [x] 3.2 实现按 Conversation 事务导入 Project/Conversation/Thread/ThreadFork/Turn/Message 和当前有效变体。
- [x] 3.3 迁移 Generation、标题、Message feedback、Artifact、usage/billing 和其他审计确认的 sidecar 外键。
- [x] 3.4 实现受批准重置路径，仅接受 ADR scope 并在执行前验证目标环境与备份标识。
- [x] 3.5 增加 A → B → C、Message 变体、partial Generation、辅助引用、重复运行和故障回滚测试。
- [x] 3.6 实现源/目标计数、映射、约束、悬空引用和摘要的全量 post-import verifier。

### 第 3 阶段本地验收记录（2026-08-22）

- 新增持久映射账本和规范 `conversation_artifacts` 表；canonical 快照从关系表恢复 Artifact provenance，不回读 legacy JSON。
- dry-run 生成 19 个 Conversation、187 个实体和逐树稳定摘要；发现 5 条 `generation_intent_missing`，显式列为需要审批的 `missing-generation-intent-as-send`，不静默推断。
- 导入按 Conversation 事务写入 Project → Conversation → Thread、Turn/Message 变体、ThreadFork、Generation/checkpoint/usage/billing、标题、Artifact 和反馈；legacy Message 级 `isCurrent` 只在 active assistant 上映射为 canonical Turn 级 current Generation。
- 本地 `--test-rollback` 对全部 19 棵树完成写入、数据库约束、源/目标计数、映射 SHA-256 与重复导入幂等校验，随后强制回滚；回滚后 mapping 和 `legacy:%` Conversation 计数均为 0。
- 受批准重置工具要求 `legacy + read-only`、drain 清零、独立 reset 开关、环境/数据库/approval ID/backup ID 精确匹配、恢复演练证明和审批前计数完全一致。它只删除 scope 内 legacy Tree 与映射可证明来源的 canonical Conversation；保留 `usage_records` 财务账本，不允许把会话重置偷换成账单抹除。仓库只验证 fail-closed 合同与事务回滚能力；没有伪造或执行任何目标环境“丢弃数据” ADR。

## 4. Authority、维护与旧协议拒绝

- [x] 4.1 实现单值 `legacy | canonical` authority 组合根、schemaVersion/cutover epoch 健康信息和非法双 authority 启动失败。
- [x] 4.2 实现维护模式，拒绝新 legacy mutations/Generation，同时保留必要只读和安全认证语义。
- [x] 4.3 实现非终态 Generation drain/Stop/stale 收敛与 usage/计费完成检查，未清零时阻止 cutover。
- [x] 4.4 为旧整树、active-leaf、Generation sidecar 和 reconcile routes 实现安全 `legacy_protocol_retired` 拒绝与遥测。
- [x] 4.5 让 canonical 客户端 boot 校验服务端 authority/schema/epoch，不匹配时不得发送写命令。

### 第 4 阶段验收记录（2026-08-22，本地隔离环境）

- `CONVERSATION_AUTHORITY` 是唯一组合根；发现任何已退役的 client/API/Generation 分裂开关时启动失败。canonical 必须携带不可为空的 `CONVERSATION_CUTOVER_EPOCH`，生产环境禁止 `CONVERSATION_ISOLATED_TEST=true`。
- `/api/conversation-authority` 发布 authority、schemaVersion、epoch 和维护状态。canonical 客户端先核对三元组，成功后才加载快照；不匹配返回 `authority_mismatch`，不会进入实体加载或写命令路径。
- `read-only` 维护模式拒绝会产生新事实的 legacy/canonical 写入；legacy GET 改为纯 owner 读取，不再认领无主树，也不借读取执行 stale 修复。Generation Stop 保留用于排空。
- 旧整树、active-leaf、Message feedback、legacy chat Generation 和 Generation sidecar 在 canonical authority 下统一返回 `410 legacy_protocol_retired`，并输出不含正文的协议名与 epoch 遥测。
- `pnpm check:conversation-cutover-drain` 只读检查 legacy/canonical 非终态 Generation、待结算计费与 canonical outbox；任一非零以退出码 2 阻止 cutover。本地实测五项均为 0、`ready=true`。
- 自动验证：typecheck；domain 8/8；Generation unit 7/7；authority/drain/import 6/6；client 14/14；command contract 5/5；数据库 persistence/Generation/command API 分别 26/52/69 assertions；真实 HTTP + 本地 PostgreSQL + 邮箱认证 + `glm-5.3` 31 assertions；OpenSpec strict 31/31；canonical production build 成功。Ego Browser 实测健康三元组为 `canonical / 1 / local-issue34-20260822`，匹配后 3 列页面与 composer 加载成功；旧整树与旧 Generation 查询均返回 410。
- 本记录只证明第 4 阶段的实现和本地隔离验收，不代表第 5 阶段的生产维护、备份、正式切换或批准已经发生。

### 本地临时数据库恢复演练（不等同于第 5 阶段）

- `pnpm rehearse:conversation-cutover-local -- --approve-local-ephemeral-databases` 在两个受限命名的 loopback 临时库中完成 legacy 备份恢复、`legacy + read-only` drain/审计、获批确定性导入两次、canonical 备份和再次恢复。
- 两次恢复均以 13 张 cutover 表的逐表 JSONB SHA-256 合并指纹证明与各自源库一致；导入后为 20 个 Conversation（含源库已有 1 个隔离夹具）和 186 条映射，总耗时约 8.4 秒。
- 同一演练在 canonical 恢复副本上执行受批准 reset 的完整 SQL 并强制事务回滚；回滚前后 13 表指纹一致，5 条相关 `usage_records` 保持不变。首次演练还实际发现并修正了非级联 Generation 复合外键所要求的删除顺序。
- 演练结束自动删除临时库、dump 和审批文件；源开发库只读。由于尚未覆盖目标基础设施、真实保留备份、负责人/观察窗口和流量切换，1.4 与 5.1 仍保持未完成。

## 5. Cutover 演练与正式执行

- [ ] 5.1 在与生产等价的隔离环境完整演练冻结、drain、备份、import/reset、验证、authority/client 切换和 smoke，并记录耗时。
- [ ] 5.2 正式进入维护窗口，冻结旧写入并确认所有 Generation、checkpoint、outbox 和计费事务已收敛。
- [ ] 5.3 创建并验证 legacy/canonical 备份，执行 ADR 选定的数据动作和全量 post-import verifier。
- [ ] 5.4 原子启用 canonical server/client epoch，对内部 canary 跑行为矩阵关键 smoke 后开放流量。
- [ ] 5.5 验证 cutover 后所有读取、命令、Generation 和 billing jobs 只访问 canonical repositories。

## 6. 观察与回滚保护

- [ ] 6.1 建立 authority mismatch、命令错误、revision/idempotency 冲突、Generation age/checkpoint、Stop/stale 和 usage 对账 dashboard/告警。
- [ ] 6.2 监控旧 route 调用、数据库查询和代码路径，记录陈旧客户端/任务调用方并完成迁移。
- [ ] 6.3 验证切换后回滚工具不会执行 canonical → ThreadTree 反向同步，也不会把落后 legacy 数据恢复为权威。
- [ ] 6.4 在声明观察窗口内完成逐日完整性/计费审计，并由负责人批准进入遗留删除阶段。

## 7. 删除遗留运行时代码

- [ ] 7.1 删除 canonical build 中的 `ThreadTreeState`、魔法 `main`、parent/children/Message forks/depth/activeLeaf 等重复领域事实和 selector。
- [ ] 7.2 删除 Tree Store mutation、`persistNow`、save debounce、卸载 flush、startup reconcile 和 Generation merge 协调代码。
- [ ] 7.3 删除旧 branch-tree/Generation 写路由、仓储和新代码对 legacy types 的导入，保留历史迁移文件不重写。
- [ ] 7.4 运行 `rg`/依赖检查证明运行时代码无旧 authority 读写，并通过完整行为矩阵、typecheck、build 和测试。

## 8. 物理清理与 OpenSpec 收口

- [x] 8.1 审计 `branch_trees`、`branch_generations` 及名称相似表的全部 FK、job、查询和备份依赖，形成精确删除清单。
- [ ] 8.2 在备份保留/恢复验证和零依赖门禁通过后，执行分阶段不可逆迁移删除确认遗留表、列、索引和约束。
- [ ] 8.3 建立旧 OpenSpec supersession map；保留已完成历史，明确记录 `persist-thread-chat-generations` 未完成项被新 lifecycle/cutover 替代，不补勾任务。
- [ ] 8.4 按依赖顺序归档新 changes，验证最终 specs 以 Project → Conversation → Thread 模型和 canonical capabilities 为权威。
- [ ] 8.5 运行最终 `pnpm openspec:validate`、schema 漂移检查、生产 smoke 和数据完整性/计费审计并记录结果。

### 第 8.1 阶段删除依赖审计（2026-08-22，本地）

- `pnpm audit:legacy-conversation-deletion` 可重复输出数据库精确行数/大小、5 条 FK、11 个索引、trigger/view/function、名称相似 relation、数据库定时任务、账单引用和 140 个分类后的仓库引用；本地未发现业务 view、显式 trigger、存储函数或 `pg_cron` 依赖。
- 本地三张 legacy 表分别为 19 个 Tree、37 个 Generation、1 条 feedback；5 条 `usage_records` 通过无 FK 的 `app_generation_id` 引用 legacy Generation，物理删除时必须保留账单流水。
- 精确删除清单记录在 `docs/architecture/issue-34-legacy-deletion-inventory.md`。产品运行时、cutover 运维工具、历史迁移/快照和备份指纹采用不同处置；禁止 `DROP ... CASCADE` 或改写历史迁移。
- 8.2 仍被 5.x 正式 cutover、6.x 观察窗口、7.x 运行时清理、目标环境复审和备份恢复批准阻塞；本次没有执行任何物理删除。
