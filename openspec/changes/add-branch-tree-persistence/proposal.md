# 分支对话树 DB 持久化（刷新不丢）

## Why

分支对话页（`app/thread-chat/`）目前纯内存：整棵分支树（主线消息、划选锚点、分支列、Artifact 登记）在刷新或重进页面后全部丢失。这是当前体验里最痛的一条——富文本、鲁棒锚点、流式平滑都已就位，唯独对话本身留不住。数据模型（`ThreadTreeState`）从一开始就是纯 JSON、可整体序列化，为持久化留好了路（设计原则 P10），现在把这条路走通。

## What Changes

- 新增 Postgres 表 `branch_trees`：一棵分支树一行，`state` jsonb 列存完整 `ThreadTreeState`。与主聊天页 assistant-ui 线性模型的 `threads`/`messages` 表**完全分开，互不复用**（两者数据语义不同：线性会话 vs 树形分支态）。
- 新增 API 路由 `GET/PUT /api/branch-trees/[treeId]`：GET 读取（未命中返回 `{ state: null }`，200），PUT upsert 整树。
- **URL 即树身份**：新增动态路由 `/thread-chat/[treeId]`——访问某个 URL 就是打开某棵树（直接访问新 UUID = 开新树）；裸路径 `/thread-chat` 重定向到「最近一棵」（localStorage 记忆）或新生成的树。顶栏加一个「新对话」按钮（跳转到新 UUID），多棵树即刻可用，无需列表 UI。
- **每棵树的工作台状态记忆**：localStorage 按 treeId 分键记住各树的打开情况（分支列/折叠态、列宽、列数覆盖、放置策略、列/画布视图），重开哪棵树就恢复哪棵树的布局；恢复前校验列引用的 thread 仍存在。对话数据（DB）与设备本地 UI 态（localStorage）分离。
- 客户端接入：页面挂载时先加载再渲染（loader + inner 拆分）；store `version` 变化后**防抖 1.5s** 整树 upsert（流式期间的高频 version 跳变被防抖合并为流式结束后一次写）；组件卸载时 flush 未落盘的写。
- 加载时 sanitize：把持久化快照里残留的非终态 assistant 消息收敛（有正文 → `done`；空占位 → 删除），避免「流式中途存盘、重载后气泡永远转圈」。
- 范围明确**不含**：会话列表 UI（侧栏枚举/删除/重命名——多树访问已由 URL + 「新对话」覆盖，列表只是发现性增强）、跨设备同步、用户体系。schema 一树一行，后续加列表零迁移障碍。

## Capabilities

### New Capabilities

- `branch-tree-persistence`: 分支对话树的存取——DB 表、API 读写契约、客户端加载/防抖存盘/卸载 flush、加载期非终态消息收敛。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本仓库尚无既有 spec；本变更不修改任何既有能力的需求级行为。）

## Impact

- **DB**：`lib/db/schema.ts` 新增 `branchTrees` 表 + drizzle 迁移一枚（注：schema 改动与 `drizzle/0004_dear_wolfsbane.sql` 迁移文件已在工作树就位、未应用未提交——上次被打断的实现残留，与本设计一致，实现阶段直接复用并应用）。
- **API**：新增 `app/api/branch-trees/[treeId]/route.ts`（Next 16 App Router route handler）。
- **前端**：`app/thread-chat/thread-chat-demo.tsx`（拆 loader/inner、接防抖存盘）、新增 `app/thread-chat/net/persist.ts`（加载/存盘/sanitize/treeId 管理）、`constants/thread-chat.ts`（localStorage key、防抖毫秒等常量归位）。
- **不改**：`core/store.ts` 零改动（`createThreadStore(seed)` 天然支持以已存状态为种子）；`/api/chat`、锚点/分支/markdown/滚动/平滑逻辑一律不动。
- **运行前提**：本地 Docker Postgres（`DATABASE_URL` 指向 `thread-chat` 库）。页面在 DB 不可用时的行为见 design.md 的降级策略。
