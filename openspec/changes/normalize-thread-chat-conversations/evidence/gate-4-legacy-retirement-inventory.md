# Gate 4 旧路径退役清单

日期：2026-08-27

本清单是 task 5.1 的生产引用映射。Gate 4 cutover 后，左列路径不得再被 `/thread-chat`、v1 Route 或 normalized runtime 引用；能复用的无计费纯模块列在右侧。

| 旧权威/入口 | 当前生产引用 | Gate 4 目标 |
| --- | --- | --- |
| `branch_trees` 整树 JSON | `lib/db/schema.ts`、`app/api/branch-trees/**`、`app/thread-chat/net/persistence/persist.ts`、`use-tree-persistence.ts`、`use-thread-chat-boot.ts`、TreeList | migration rename 为 `legacy_branch_trees_backup`；新 schema 不 export；`/thread-chat` 只用 v1 Project bootstrap/commands |
| `branch_generations` sidecar | `lib/thread-chat-generation/**`、`app/api/branch-generations/**`、`app/api/chat/thread-generation-context.ts`/settlement、客户端 `generation/**` | rename 为 `legacy_branch_generations_backup`；生产生成只用 Message + StreamSession + v1 poll |
| `branch_message_feedback` | 旧 feedback repository/route | rename 为 `legacy_branch_message_feedback_backup`；反馈只写 `messages.feedback` |
| active-leaf / variant | `lib/thread-chat/contracts/switch-active-leaf.ts`、旧 route、legacy message graph/types/store | 删除旧 route/contract/客户端可见入口；normalized timeline 只按 `superseded_at is null` 投影 |
| 整树 save gate/revision | `save-tree.ts`、`tree-revision.ts`、`persist.ts`、`save-tree-response.ts`、`tree-save-gate.ts` | 删除生产消费者；v1 command receipt 与事务替代 revision/PUT |
| generation reconciliation | `app/thread-chat/generation/**`、`lib/thread-chat/application/reconcile-turns.ts`/旧 projection helpers | 删除生产消费者；bootstrap active generation 直接 background poll |
| 旧 `/api/chat` threadChat mode | `app/thread-chat/net/chat-controller.ts`、`chat-generation-command.ts`、prompt tree compiler | `/thread-chat` 零调用；v1 `run-generation` 为唯一模型入口 |
| 旧 generation billing settlement | `app/api/chat/stream-lifecycle.ts`、generation settlement、`lib/thread-chat-generation/finalize.ts` | v1 零 import/零调用；旧线性 Chat 页面仍可独立保留 `/api/chat`，但 ThreadChat 不再经过它 |
| TreeList 旧 CRUD | `listTrees/renameTree/deleteTree` | 改为 v1 `listProjects/renameProject/deleteProject`，保持现有弹层 UI |
| 裸路径最近树记忆 | `TreeRedirect` 读取旧 `LAST_TREE_ID_KEY` | 改为 v1 Project list，取最近 Project；为空时生成 UUID |

## 可复用且必须保留的纯能力

- `TextAnchor` 采集/恢复、selection bubble、脚注与现有 Markdown 锚点渲染。
- prompt budget、模型注册表、无计费 system prompt 模板、Markdown Artifact 工具与 web research 显示/typed parts。
- 列布局、画布、ThreadSwitcher、TreeListRow、Composer、消息 toolbar、ArtifactDrawer、Help/Toast/CSS。
- `/api/chat` 仍可服务仓库中非 ThreadChat 的线性 assistant-ui 页面；Gate 4 只移除其 `threadChat` 分支和 ThreadChat 依赖，不把无关产品路径一并删除。

## 出场扫描

Gate 4 增加静态扫描，要求正式 `app/thread-chat` 入口及其 normalized 依赖闭包不包含：`/api/branch-trees`、`/api/branch-generations`、`/api/chat`、`branchTrees`、`branchGenerations`、`branchMessageFeedback`、`lib/billing`、`credits`、`usage-store`、`saveTree`、`active-leaf`。
