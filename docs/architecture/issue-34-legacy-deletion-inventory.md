# Issue 34：Legacy Conversation 物理删除依赖清单

状态：**清单已建立，禁止执行物理删除**。本文完成 OpenSpec 8.1 的依赖审计，不代表 8.2 的不可逆删除门禁已经通过。

## 可重复审计入口

运行：

```bash
pnpm audit:legacy-conversation-deletion
```

该命令只读查询当前数据库和仓库，输出精确行数/大小、FK、索引、trigger、view、function、名称相似 relation、数据库定时任务、`usage_records` 引用，以及按运行时/运维/Schema 与迁移/测试/文档分类的仓库引用。目标环境执行时必须把完整 JSON 保存到 cutover 证据包，不能拿本文的本地数字代替。

## 本地基线（2026-08-22）

| 表                                    | 行数 |    总大小 | 角色                           |
| ------------------------------------- | ---: | --------: | ------------------------------ |
| `thread_chat.branch_trees`            |   19 | 589,824 B | legacy 整树 JSON 权威          |
| `thread_chat.branch_generations`      |   37 | 540,672 B | legacy Generation/计费 sidecar |
| `thread_chat.branch_message_feedback` |    1 |  49,152 B | legacy Message feedback        |

审计同时发现 5 条 `usage_records.app_generation_id` 指向 legacy Generation。该列没有 FK，这是刻意的账单保留边界：删除会话数据不得删除、置空或改写这些流水。

数据库中没有依赖这三张表的业务 view、materialized view、显式 trigger、存储函数或 `pg_cron` 任务。名称相似 relation 必须逐项核对，尤其是 canonical 的 `conversation_generations`、`conversation_message_feedback` 和 `legacy_conversation_entity_mappings`；它们不是同义旧表，不能随 legacy 三表一起删除。

## 数据库依赖与删除顺序

已确认 FK 共 5 条：

1. `branch_generations.tree_id → branch_trees.id ON DELETE CASCADE`
2. `branch_message_feedback.tree_id → branch_trees.id ON DELETE CASCADE`
3. 三张表各自的 `user_id → user.id ON DELETE CASCADE`

不存在从其他业务表指向这三张表的 FK。物理迁移仍不得使用无边界的 `DROP ... CASCADE`，而应显式按以下顺序删除：

1. 再次验证备份 ID、恢复演练、观察窗口批准和 legacy 查询为零。
2. 删除 `branch_message_feedback`。
3. 删除 `branch_generations`。
4. 删除 `branch_trees`。
5. 保留 `usage_records` 及其中的原始 `app_generation_id`；保留已归档迁移历史。
6. 从当前 Drizzle schema 移除三张表定义，生成新的前滚迁移；不得改写 `0000`—`0003` 或历史 snapshot。
7. 迁移后再次运行系统目录查询，证明表、约束、索引不存在，而 canonical 表和账单流水仍存在。

## 运行时依赖

仓库直接文本审计目前得到 140 个引用文件，其中运行时引用仍覆盖以下边界；因此 8.2 当前明确被阻塞：

- legacy HTTP：`/api/branch-trees/**`、`/api/branch-generations/**`，以及旧 `/api/chat` ThreadTree Generation 分支。
- legacy repository：`lib/thread-chat-generation/` 下的 tree、Generation lifecycle、feedback、stale、Stop/finalize 查询与写入。
- legacy client/domain：`app/thread-chat/` 的 Tree store、boot、persist、reconcile、prompt、selector、列/画布/导航适配，以及 `lib/thread-chat/domain` 中的 `ThreadTreeState`/message graph/regeneration/selectors。
- cutover compatibility：legacy audit、deterministic import、drain、approved reset 和本地恢复演练。

这里必须区分两类依赖：

- 产品运行时依赖必须在 OpenSpec 7.1—7.4 完成时删除或改成纯 canonical；只把旧 route 改成 410 仍然不等于零数据库依赖。
- cutover 运维依赖在观察窗口、备份保留期和删除批准前必须保留。它们不能被产品 bundle 调用，但需要读取 legacy 表完成审计、恢复和取证。

`vercel.json` 只有 `/api/billing/reconcile` 定时任务。它不查询 legacy 表，但会处理上述保留的 `usage_records`，因此表删除不能破坏账单对账。

## 测试、备份与历史依赖

- `e2e/thread-chat/` 的 legacy DB 测试必须在运行时删除 commit 中替换或移入历史证据，不能继续成为默认 canonical CI 的前置条件。
- `scripts/rehearse-conversation-cutover-local.mjs` 的 13 表指纹刻意包含三张 legacy 表。在观察窗口结束前保持不变；进入 8.2 时应建立“删除前备份指纹”和“删除后 canonical-only 指纹”两个不同版本，不能静默覆盖旧口径。
- `scripts/import-legacy-conversations.ts`、legacy audit、reset 与 drain checker 在不可逆删除前保留；删除后归档其版本与运行输出，运行入口必须 fail closed，而不是继续查询不存在的表。
- `drizzle/0000`—`0003`、历史 meta snapshot 和已完成 OpenSpec 文档是历史记录，只读保留。新的 drop migration 只能前滚追加。

## 8.2 放行条件

以下条件缺一不可：

- OpenSpec 5.1—5.5 完成，目标环境 canonical authority 已正式切换。
- OpenSpec 6.1—6.4 完成，观察窗口内旧 route、旧 SQL 和旧 job 调用连续为零。
- OpenSpec 7.1—7.4 完成，生产 bundle 与运行时依赖扫描中不再存在 legacy repository/Tree authority。
- 目标环境重新运行本审计；没有未知 FK/view/function/trigger/job，名称相似 relation 全部获得明确处置。
- 两套备份均有可恢复证明：删除前 legacy/canonical 完整备份，以及切换后 canonical 权威备份。
- 5 条及目标环境全部 `usage_records` 已纳入账单保留/对账验证。
- 负责人审批分阶段 drop migration、回滚边界与不可逆时刻。

在这些条件满足前，8.2 必须保持未完成。
