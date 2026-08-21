# Conversation 持久化 dry-run 审计证据（2026-08-22）

## 执行边界

- 目标：本机 `localhost:5432/thread-chat` 的 `thread_chat` schema。
- 命令：`pnpm audit:legacy-conversations -- --summary-only`。
- 模式：`dry-run`、只读；读取 `branch_trees`、`branch_generations` 与 `branch_message_feedback`，未写入遗留表或规范表。
- 规范迁移 `0004_wild_scarlet_witch.sql` 已在同一目标成功执行；新增表默认不承载生产写入。

## 结果

| 指标 | 数量 |
| --- | ---: |
| 遗留树 | 18 |
| 已有 owner | 18 |
| 无 owner | 0 |
| 可直接映射 | 18 |
| 需修复 | 0 |
| 拒绝 | 0 |
| Thread | 21 |
| Turn | 32 |
| Message | 67 |
| Fork | 3 |
| Artifact | 0 |
| Generation 辅助记录 | 35 |
| Message feedback | 1 |

所有稳定审计错误码的计数均为 0。逐树 dry-run 同时生成了确定性的 Conversation、Thread 与 Message ID 映射。

## 对最终切换的含义

当前本地证据表明，18 棵遗留树都满足已知结构、归属、Fork、active leaf、Generation 与反馈引用不变量，因此技术上可以一次性导入，不需要因污染数据强制重置。这个结论只适用于本次审计的本地目标；最终 `retire-thread-tree-authority` 在每个待切换环境必须重新执行同一只读审计，再决定迁移或重置，不能把本地结果外推为生产事实。
