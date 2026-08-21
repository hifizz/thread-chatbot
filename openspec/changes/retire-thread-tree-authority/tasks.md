## 1. 前置实现与发布门禁

- [ ] 1.1 验证 `define-conversation-domain-model`、规范持久化、Generation lifecycle、命令 API 和 normalized client 的必需任务及 strict specs 全部完成。
- [ ] 1.2 建立目标行为矩阵，关联认证、生命周期、列/画布、A → B → C Fork、变体、actions、Artifact/研究、Generation/计费的自动测试和 smoke。
- [ ] 1.3 记录当前容量/性能/错误/计费基线、cutover 阈值、负责人、观察窗口和 go/no-go checklist。
- [ ] 1.4 演练 canonical 备份恢复、维护模式、authority epoch mismatch 和切换后只读/前滚回滚流程。

## 2. 数据审计与处置 ADR

- [ ] 2.1 在目标环境运行只读 legacy 审计，输出所有者、Conversation/Thread/Message/Generation、标题、反馈、Artifact 和 usage 数量。
- [ ] 2.2 逐项处理或明确阻塞悬空、跨所有者、重复 ID、错误 Fork/active path 和计费引用。
- [ ] 2.3 基于保留义务形成“确定性导入或受批准重置”ADR，记录范围、理由、批准人、备份和排除项。
- [ ] 2.4 将 ADR 结果转成版本化 cutover 配置，不在代码中隐式猜测环境或数据处置方式。

## 3. 确定性导入或重置工具

- [ ] 3.1 实现 `(legacyTreeId, entityType, localId) → canonicalId` 的持久映射与幂等 dry-run/report。
- [ ] 3.2 实现按 Conversation 事务导入 Project/Conversation/Thread/ThreadFork/Turn/Message 和当前有效变体。
- [ ] 3.3 迁移 Generation、标题、Message feedback、Artifact、usage/billing 和其他审计确认的 sidecar 外键。
- [ ] 3.4 实现受批准重置路径，仅接受 ADR scope 并在执行前验证目标环境与备份标识。
- [ ] 3.5 增加 A → B → C、Message 变体、partial Generation、辅助引用、重复运行和故障回滚测试。
- [ ] 3.6 实现源/目标计数、映射、约束、悬空引用和摘要的全量 post-import verifier。

## 4. Authority、维护与旧协议拒绝

- [ ] 4.1 实现单值 `legacy | canonical` authority 组合根、schemaVersion/cutover epoch 健康信息和非法双 authority 启动失败。
- [ ] 4.2 实现维护模式，拒绝新 legacy mutations/Generation，同时保留必要只读和安全认证语义。
- [ ] 4.3 实现非终态 Generation drain/Stop/stale 收敛与 usage/计费完成检查，未清零时阻止 cutover。
- [ ] 4.4 为旧整树、active-leaf、Generation sidecar 和 reconcile routes 实现安全 `legacy_protocol_retired` 拒绝与遥测。
- [ ] 4.5 让 canonical 客户端 boot 校验服务端 authority/schema/epoch，不匹配时不得发送写命令。

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

- [ ] 8.1 审计 `branch_trees`、`branch_generations` 及名称相似表的全部 FK、job、查询和备份依赖，形成精确删除清单。
- [ ] 8.2 在备份保留/恢复验证和零依赖门禁通过后，执行分阶段不可逆迁移删除确认遗留表、列、索引和约束。
- [ ] 8.3 建立旧 OpenSpec supersession map；保留已完成历史，明确记录 `persist-thread-chat-generations` 未完成项被新 lifecycle/cutover 替代，不补勾任务。
- [ ] 8.4 按依赖顺序归档新 changes，验证最终 specs 以 Project → Conversation → Thread 模型和 canonical capabilities 为权威。
- [ ] 8.5 运行最终 `pnpm openspec:validate`、schema 漂移检查、生产 smoke 和数据完整性/计费审计并记录结果。
