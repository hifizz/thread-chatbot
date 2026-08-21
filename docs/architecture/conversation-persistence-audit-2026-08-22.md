# Conversation 持久化 dry-run 审计证据（2026-08-22）

## 执行边界

- 目标：本机 `localhost:5432/thread-chat` 的 `thread_chat` schema。
- 命令：`pnpm audit:legacy-conversations -- --summary-only`。
- 模式：`dry-run`、只读；读取 `branch_trees`、`branch_generations` 与 `branch_message_feedback`，未写入遗留表或规范表。
- 规范迁移 `0004_wild_scarlet_witch.sql` 已在同一目标成功执行；新增表默认不承载生产写入。

## 结果

| 指标 | 数量 |
| --- | ---: |
| 遗留树 | 19 |
| 已有 owner | 19 |
| 无 owner | 0 |
| 可直接映射 | 15 |
| 需修复 | 4 |
| 拒绝 | 0 |
| Thread | 22 |
| Turn | 34 |
| Message | 71 |
| Fork | 3 |
| Artifact | 0 |
| Generation 辅助记录 | 37 |
| Message feedback | 1 |

结构、归属、Fork、active leaf、Artifact 和反馈错误均为 0。审计新增发现 5 条早期 Generation sidecar 没有 `turn_snapshot.intent`，分布在 4 棵树，稳定错误码为 `generation_intent_missing`。导入器不会隐式猜测：dry-run 将它们逐条列入 repair 清单；写入模式只有在审批文件明确包含 `missing-generation-intent-as-send` 时，才把这些已终态记录按最弱的 `send` 来源语义保留，且绝不据此重新调用模型。

逐树 dry-run 同时生成持久的 `(legacyTreeId, entityType, localId) → canonicalId` 映射计划。当前计划为 19 个 Conversation、187 个实体，摘要为 `ee3736d92957dd4090f8fd8e765f01f4f3c84ca01aaed86db67416b15c860eb1`。

## 对最终切换的含义

当前本地证据表明，19 棵遗留树均无拒绝级污染，15 棵可直接导入，另外 4 棵只需上述 5 条可枚举的来源语义修复，因此技术上适合确定性导入，不需要重置。完整导入已在单一数据库事务中对 19 棵树逐 Conversation 写入、校验、重复写入验证幂等，最后强制回滚；回滚后映射账本和 `legacy:%` Conversation 均为 0。这个结论只适用于本次本地目标；正式环境仍须重新审计、备份并单独批准。
