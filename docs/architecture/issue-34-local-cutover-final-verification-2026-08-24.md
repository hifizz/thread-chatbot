# Issue #34 本地 canonical cutover 最终验收

## 最终结论

`localhost/thread-chat` 已完成 `Project → Conversation → Thread` 规范模型切换。运行时、HTTP、Generation、客户端和数据库只使用 canonical repositories；`ThreadTree` 不再是产品运行时权威，四张 legacy/cutover 表已通过前滚迁移物理删除。

19 棵 legacy Tree 是仓库负责人确认的本地测试数据。本次没有导入；它们只保留在已验证的本地 dump 中，不重新写回数据库。

## 数据保护

- dump：`.local-backups/issue34-thread-chat-2026-08-23T16-15-30.035Z.dump`，459 KiB。
- SHA-256：`5278aafc7f9d4bf01607133c09dfff7a9846f9543a68d7ee482097337f2cf078`，最终验收时重新计算一致。
- 恢复验证：`local-restore-f6e6289ecb5b`。
- 源/恢复 28 表指纹：`a02bf8458579a046856caa4fe0797525086eb97f698bf7e01a2f9bae9d9d081c`，两侧一致。
- dump 与 `.verification.json` 均位于 Git 忽略目录，完成后继续保留；未执行 19 棵 Tree 的 legacy import。

## Authority、数据与物理删除

- authority：`canonical`；schema version：`1`；epoch：`local-issue34-20260824`。
- drain：legacy/canonical active Generation、pending billing、canonical pending outbox 全部为 0。
- 运行时边界扫描：172 个运行时文件，旧 authority 引用 0。
- 已删除：`branch_trees`、`branch_generations`、`branch_message_feedback`、`legacy_conversation_entity_mappings`。
- 删除迁移：`drizzle/0014_reflective_diamondback.sql`，显式 `DROP TABLE`，没有 `CASCADE`；历史迁移不改写。
- 保留：`usage_records` 42 条、`external_usage_records` 20 条；账单历史未随会话测试数据删除。
- 最终 canonical 数据：1 Workspace、1 Project、1 Conversation、3 Thread、9 Turn、19 Message、2 ThreadFork、1 Artifact、10 Generation、1 Message feedback。

## 行为验收

- 真实 HTTP：邮箱认证、本地 PostgreSQL、`glm-5.3`、bootstrap、两次 Turn、Markdown Artifact、feedback、删除，共 38 项断言通过。
- Ego Browser：A → B → C 三列、真实 GLM 5.3、Markdown Artifact 抽屉、真实联网研究、来源、刷新恢复全部通过。
- Artifact 同时支持模型工具调用和供应商忽略强制 tool choice 时的确定性 Markdown 持久化兜底，来源绑定稳定 Conversation/Thread/Message ID。
- 联网研究保留 plan/activity/source；实测搜索、页面读取和官方来源在刷新后仍可恢复。
- 前滚恢复规划器使用真实首个 canonical 写入时间与已验证备份，输出 `post-write-forward-recovery / canonical-to-canonical`，并拒绝 canonical → legacy、恢复 legacy 权威和重新启用 branch-tree 写入。

## 自动验证

- typecheck：通过。
- lint：0 error；仅保留 3 个与本 change 无关的既有 warning。
- domain：8/8。
- Generation unit：7/7。
- normalized client：14/14。
- authority/drain/recovery：12/12。
- command HTTP contract：5/5。
- canonical E2E：30/30。
- 数据库 persistence / Generation / command API：26 / 52 / 69 项断言。
- OpenSpec strict：30/30（六个 change 归档后重新验证）。
- `audit:conversation-domain`：172 文件、0 旧引用。
- `audit:conversation-cutover-health`：0 active、0 pending billing、0 pending outbox、0 token mismatch、0 runtime legacy reference。
- Next.js Webpack production build：通过。
- Drizzle 漂移：迁移应用后 `db:generate` 无 schema changes。没有用 `db:push` 代替版本化发布迁移；本地可自由 `db:push` 不改变这一发布可审计性边界。

## 本地观察窗口处置

这是单用户、本地、零外部流量目标，不存在生产陈旧客户端、定时任务或独立部署实例。数据库无法提供的 HTTP 指标没有被伪装为零；由运行时零引用、旧 route 删除、Ego Browser/API smoke、drain 和最终健康审计共同取代流量 dashboard。仓库负责人要求持续执行至本地目标完成，构成本地删除阶段批准；该证据不能复用于任何共享、Preview 或 Production 数据库。
