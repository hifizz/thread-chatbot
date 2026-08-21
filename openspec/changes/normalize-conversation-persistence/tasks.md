## 1. 数据结构与迁移

- [ ] 1.1 定义 `workspaces`、`workspace_members`、`projects`、`conversations`、`conversation_threads`、`thread_forks`、`conversation_turns`、`conversation_messages` 的 Drizzle 结构和稳定命名。
- [ ] 1.2 生成迁移并补充 Drizzle 无法表达的可延迟复合外键、唯一约束与约束触发器。
- [ ] 1.3 为所有者查询、Conversation 列表、Thread/Turn 顺序、来源 Message 和当前有效变体建立必要索引。
- [ ] 1.4 更新本地 schema reset 脚本，使新表只在明确目标 schema 中创建或删除，不影响其他数据库。

## 2. 规范仓储

- [ ] 2.1 建立 Workspace/Project 与 Conversation/Thread 的纯应用仓储端口和 Drizzle 适配器。
- [ ] 2.2 实现 ThreadFork 事务写入与根、唯一来源、同 Conversation、来源 Message 归属和无环校验。
- [ ] 2.3 实现 Turn/Message 追加、角色校验和当前有效变体的预期版本更新。
- [ ] 2.4 实现确定性 `ConversationSnapshot` 组装、稳定排序和可重建派生索引。
- [ ] 2.5 增加服务端配置边界，默认禁止规范仓储承载生产写入，并拒绝未声明双写模式。

## 3. 遗留审计

- [ ] 3.1 实现只读 `ThreadTreeState` 审计器和 legacy → canonical ID/实体映射报告。
- [ ] 3.2 检查根、Fork、Message 图、active leaf、Artifact、反馈和 `branch_generations` 悬空引用，并为每类错误定义稳定代码。
- [ ] 3.3 增加 dry-run 命令，仅输出汇总与逐树报告，不修改旧表或规范表。
- [ ] 3.4 在目标环境执行审计并记录“可重置或必须迁移”的数据证据，供最终切换 change 决策。

## 4. 约束验证

- [ ] 4.1 覆盖最小根 Conversation、A → B → C Fork、同 Turn 回复变体和有效选择的成功用例。
- [ ] 4.2 覆盖跨 Conversation Fork、来源 Message 错配、第二入向 Fork、Fork 环、跨 Thread Message/Turn 和错误角色 active Message 的拒绝用例。
- [ ] 4.3 验证两个相同读取产生等价 `ConversationSnapshot`，且仓储没有整包快照写入端口。
- [ ] 4.4 运行数据库迁移、`pnpm typecheck`、`pnpm openspec:validate` 和相关验证脚本并记录结果。
