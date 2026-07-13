# 会话列表 UI（分支树的列表、重命名与删除）

## Why

多树能力已由「URL 即身份」上线（add-branch-tree-persistence），但发现性只有书签/浏览器历史——用户看不到自己有哪些树、找不回没记 URL 的对话，测试/随手开的树也无法清理，DB 只进不出。需要一个树级别的列表入口，补全「多会话」的最后一环。

## What Changes

- **顶栏「对话列表」按钮 + 弹层**（已拍板：不占多列工作台空间；裸路径「跳最近一棵」行为不变）：列出所有已保存的树，按最近更新排序；条目显示标题、相对更新时间、分支数；当前树高亮置顶（未保存的当前树也显示并标注）；快捷键 ⌘⇧K，Esc 纳入现有逐层关闭链。
- **管理能力**（已拍板：完整管理）：条目内联重命名（Enter 确认/Esc 取消）、删除（二段确认）；删除当前树后自动跳转到剩余最近一棵（没有则新树），并清理该树的 localStorage 工作台记忆。
- **自定义标题不被派生标题覆盖**：`branch_trees` 加 `custom_title` 列（可空）；重命名写 `custom_title`，防抖存库继续只写派生 `title`，展示取 `coalesce(custom_title, title)`——两条写路径互不踩踏。
- **API 扩展**：新增 `GET /api/branch-trees`（列表：id/展示标题/updatedAt/threadCount，SQL 内取 jsonb 键数，不回传整树 state）、`PATCH /api/branch-trees/[treeId]`（重命名）、`DELETE /api/branch-trees/[treeId]`（删除，幂等）。
- 范围**不含**：搜索/过滤（树数量大了再说）、分页（limit 100 兜底）、批量操作、归档。

## Capabilities

### New Capabilities

- `tree-list-ui`: 树列表的枚举/切换/重命名/删除——列表 API 契约、custom_title 双轨标题、弹层交互（打开/高亮/内联改名/二段删除/删除后跳转）、快捷键与关闭链。

### Modified Capabilities

- `branch-tree-persistence`: PUT 语义微调——upsert 不触碰 `custom_title`（新列），展示标题规则变为 coalesce 双轨。

## Impact

- **DB**：`branch_trees` 加 `custom_title text` 可空列（一枚新迁移 0005，纯加列零风险）。
- **API**：新增 `app/api/branch-trees/route.ts`（GET 列表）；`[treeId]/route.ts` 增加 PATCH/DELETE。
- **前端**：新增 `app/thread-chat/orchestration/tree-list.tsx`（弹层，沿用 ⌘K 切换器 swx 交互语言与 .tc 视觉）；`net/persist.ts` 增加 listTrees/renameTree/deleteTree；壳层顶栏加按钮、⌘⇧K、Esc 链；CSS 追加。
- **不改**：store/锚点/分支/滚动/平滑；PUT 的派生 title 逻辑照旧。
