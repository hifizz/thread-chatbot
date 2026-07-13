# tree-list-ui 会话列表

## ADDED Requirements

### Requirement: 列表 API

系统 SHALL 提供 `GET /api/branch-trees`，返回全部已保存树的轻量列表 `{ trees: [{ id, title, updatedAt, threadCount }] }`：按 `updated_at` 降序、上限 100 条；`title` 为展示标题（`coalesce(custom_title, title)`，两者皆空回退「未命名对话」）；`threadCount` 在 SQL 内由 `state->'threads'` 的键数派生，响应 SHALL 不包含整树 `state`。

#### Scenario: 列表排序与轻量性

- **WHEN** 存在多棵已保存的树
- **THEN** 返回按最近更新降序的条目，每条含 id/展示标题/updatedAt/threadCount 而不含 state

### Requirement: 重命名（自定义标题双轨）

系统 SHALL 提供 `PATCH /api/branch-trees/{treeId}`，body `{ title }`（trim 后非空、≤60 字，否则 400；树不存在 404）写入 `custom_title` 列。防抖整树 PUT SHALL 继续只更新派生 `title` 列、不触碰 `custom_title`。展示一律取 `coalesce(custom_title, title)`。

#### Scenario: 重命名后继续聊天不被覆盖

- **WHEN** 用户把某树重命名为「我的调研」，随后在该树继续对话触发若干次防抖存库
- **THEN** 列表与后续加载中该树标题始终为「我的调研」（派生标题只更新 title 列，展示仍取 custom_title）

#### Scenario: 非法重命名

- **WHEN** PATCH body 的 title 为空白或超长
- **THEN** 返回 400 且不写库

### Requirement: 删除

系统 SHALL 提供 `DELETE /api/branch-trees/{treeId}`：删除该行，幂等（不存在也返回 `{ ok: true }`）。客户端删除成功后 SHALL 一并清理该树的 localStorage 工作台记忆（`thread-chat:ui:{treeId}`），若「最近一棵」指向被删树则一并清除。

#### Scenario: 删除非当前树

- **WHEN** 用户在弹层中删除一棵非当前树并确认
- **THEN** 条目从列表消失、DB 行删除、其 localStorage 工作台记忆被清理；当前树不受影响

#### Scenario: 删除当前树

- **WHEN** 用户删除当前正打开的树并确认
- **THEN** 页面自动跳转到剩余树中最近更新的一棵；一棵不剩时跳转到新 UUID（空树）

### Requirement: 弹层交互

顶栏 SHALL 提供「对话列表」按钮（新对话旁），点击或 ⌘⇧K 打开弹层；弹层 SHALL 纳入现有 Esc 逐层关闭链（先关弹层再关其他）。每次打开 SHALL 重新拉取列表。条目显示展示标题、相对更新时间（如「3 分钟前」）、分支数徽标；**当前树高亮并置顶**——当前树尚未入库（空树未保存）时 SHALL 仍显示于顶部并标注「未保存」。点击条目跳转到该树 URL（点当前树仅关闭弹层）。

#### Scenario: 打开列表并切换

- **WHEN** 用户按 ⌘⇧K 打开弹层并点击另一棵树
- **THEN** 页面跳转到该树 URL、其数据与工作台布局按既有持久化规则恢复

#### Scenario: 未保存的当前树

- **WHEN** 用户在一棵从未发过消息的新树上打开弹层
- **THEN** 顶部显示当前树条目并标注「未保存」，其余条目为已保存的树

#### Scenario: 内联重命名交互

- **WHEN** 用户点击条目的重命名入口、修改文本后按 Enter
- **THEN** 名称就地更新（Esc 则放弃）；失败时保留原名并给出轻提示

#### Scenario: 二段删除确认

- **WHEN** 用户点击条目的删除入口
- **THEN** 首次点击进入确认态（如按钮变「确认删除」），再次点击才执行；点击他处或 Esc 取消确认态
