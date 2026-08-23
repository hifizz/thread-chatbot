# Issue #34 本地 cutover 执行记录

## 结论

2026-08-24，`localhost/thread-chat` 按版本化 manifest `issue-34-local-cutover-release-2026-08-24.json` 执行 `approved-reset`。19 棵 legacy Tree 是无保留义务测试数据，未导入；完整备份是这些记录的唯一保留副本。

## 前置审计

- legacy：19 Tree、22 Thread、34 Turn、71 Message、3 Fork、37 Generation、1 feedback、0 Artifact。
- 数据问题：4 棵 Tree 的 5 条历史 Generation 缺少 intent；无悬空、跨所有者、重复 ID、错误 active path 或拒绝级记录。
- drain：legacy/canonical active Generation、pending billing 和 canonical pending outbox 五项均为 0。
- canonical：1 Conversation、3 Thread、13 Message。
- `usage_records`：39 条；reset scope 没有 canonical mapping，因此没有账单流水进入删除集合。

## 备份与恢复

- dump ID：`sha256:5278aafc7f9d4bf01607133c09dfff7a9846f9543a68d7ee482097337f2cf078`
- 恢复验证 ID：`local-restore-f6e6289ecb5b`
- 源/恢复 28 表指纹：`a02bf8458579a046856caa4fe0797525086eb97f698bf7e01a2f9bae9d9d081c`
- dump 位于忽略目录 `.local-backups/`，不会进入 Git；完成本 Goal 前必须保留。

## 执行

1. manifest execution gate 通过，SHA-256：`1921e4ae0b8f06c624fb85f92b4e610fb69114df3a447b8371bdbe60f1380182`。
2. `--test-rollback` 精确命中 19 Tree、37 Generation、1 feedback，`committed=false`。
3. 相同 manifest/approval/backup 合同执行 `--execute`，`committed=true`。
4. post-reset 审计：legacy 0/0/0；canonical 1 Conversation/3 Thread/13 Message；`usage_records` 39。

## 后续完成记录

reset 之后继续完成了 canonical-only 客户端、API、Generation、Artifact/研究和 billing 路径，删除旧运行时与四张 legacy/cutover 表，并通过真实 HTTP、GLM 5.3、Ego Browser、数据库、构建和 OpenSpec 验收。完整结果见 `issue-34-local-cutover-final-verification-2026-08-24.md`。
