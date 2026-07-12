# 任务拆解：分支对话树 DB 持久化

## 1. DB 层（复用工作树残留，应用迁移）

- [x] 1.1 核对工作树已有的 `lib/db/schema.ts` branchTrees 改动与 `drizzle/0004_dear_wolfsbane.sql` 内容一致（不要重新 generate），执行 `pnpm db:migrate` 应用；用一条 SQL 确认 `branch_trees` 表已建
- [x] 1.2 `constants/thread-chat.ts` 追加持久化常量：localStorage key（`thread-chat:tree-id`）、防抖毫秒（1500）、派生标题截断长度（20），带用途注释

## 2. API 路由

- [x] 2.1 新增 `app/api/branch-trees/[treeId]/route.ts`：treeId UUID 形状校验（不合法 400）；GET 命中返回 `{ state }`、未命中返回 200 + `{ state: null }`；PUT 浅校验（state 存在且为对象，否则 400）后用 drizzle `onConflictDoUpdate` upsert（state/title/updatedAt），返回 `{ ok: true }`。照 `app/api/threads/[threadId]/route.ts` 的 Next 16 写法（params 是 Promise 要 await）
- [x] 2.2 curl 冒烟：GET 未知合法 UUID → `{"state":null}`；GET 非法 id → 400；PUT 一个最小 state → `{"ok":true}`；再 GET → 返回该 state；PUT 缺 state → 400

## 3. 客户端：路由 + 持久化层

- [x] 3.1 新增 `app/thread-chat/net/persist.ts`：`isValidTreeId(id)`（UUID 形状校验）、`rememberTreeId(id)` / `getLastTreeId()`（localStorage「最近一棵」读写）、`loadTree(id)`（GET，失败返回 null 并 console.warn）、`saveTree(id, state, title?)`（PUT，失败 console.warn 不抛）、`sanitizeLoadedState(state)`（assistant 非终态收敛：有正文→done、空占位→删除；纯函数，文件头注释说明为什么需要）
- [x] 3.2 路由改造：新增 `app/thread-chat/[treeId]/page.tsx`（server component，`await params` 取 treeId、UUID 校验不合法 `notFound()`，metadata 沿用，渲染客户端 loader）；原 `app/thread-chat/page.tsx` 改为入口跳板（客户端 effect：`getLastTreeId() ?? randomUUID()` → `router.replace`，渲染 `.tc` 风格一行占位）
- [x] 3.3 `thread-chat-demo.tsx` 拆分：现组件改名 `ThreadChatDemoInner`，props 加 `initialState: ThreadTreeState` 与 `treeId: string`，`createThreadStore(initialState)`；内部其余逻辑（编排/放置/画布/⌘K/controller）一律不动
- [x] 3.4 loader（接收 treeId prop）：挂载 effect 里 `loadTree(treeId) → sanitize → setSeed`（失败/null → `emptySeedState()` 降级 + console.warn）+ `rememberTreeId(treeId)`；加载中渲染 `.tc` 风格一行占位；加载完渲染 inner。localStorage/fetch 只在 effect 里碰
- [x] 3.5 inner 加防抖存盘：effect 监听 `useThreadStore` 的 version 变化（首屏不写），重置 1.5s 定时器到点 `saveTree(treeId, store.getState(), 派生title)`；卸载时有 pending 则立即 flush；派生 title = main 首条 user 消息前 20 字，无则「未命名对话」
- [x] 3.6 顶栏加「新对话」按钮：跳转 `/thread-chat/{crypto.randomUUID()}`（样式沿用现有顶栏 pill/按钮风格，放返回链接旁）
- [x] 3.7 每棵树的工作台状态记忆（D7）：`persist.ts` 增加 `loadUiState(treeId)` / `saveUiState(treeId, ui)`（localStorage key `thread-chat:ui:{treeId}`，含 slots/widths/forceCols/mode/viewMode；load 时校验 threadId 存在性，失配过滤、全空回 null）；`useColumnSlots` 加可选初始 slots/widths 入参（默认现状）；Inner 里 forceCols/mode/viewMode 用传入初值，并用 ~300ms 轻防抖把这五项变化写回 localStorage；loader 加载树数据后读 UI 状态、校验后随 initialState 一起传给 Inner

## 4. 验收（真实执行，全绿才算完）

- [x] 4.1 `pnpm typecheck` 0 错误；`npx eslint app/thread-chat app/api lib constants` 0 报错
- [x] 4.2 端到端持久化（playwright-core + CHROMIUM_PATH，脚本放仓库根跑完删）：打开 `/thread-chat` → 断言被 replace 到 `/thread-chat/{uuid}` → 发消息等流式完 → 划选开分支、回车确认 → 等 2s 过防抖 → **同一 context 重载该 URL** 断言全恢复（主线消息/分支列/锚点高亮脚注、无 pending 转圈气泡）→ **再开全新 context（无 localStorage）直接访问同一 URL** 断言同样恢复（URL 即身份的真验证）→ 「新对话」按钮跳新 UUID 且空树、原 URL 回访原树仍在；**工作台记忆**：重载后断言分支列仍开着（slots 恢复，非只剩主线）；断言 DB 该 treeId 行存在且 state.threads 含 main+分支；截图存 `e2e/thread-chat/shots/persist-restored.png`
- [x] 4.3 sanitize 路径验证：流式进行中（未到防抖点前手动触发一次 saveTree 或缩短等待窗口造出「半截快照」）重载 → 半截消息以 done 显示、无转圈（若难以稳定构造，可用 node 直接往 DB 写一个含 pending/streaming 消息的 state 再加载验证）
- [x] 4.4 回归：`BASE_URL=http://localhost:4040 node e2e/thread-chat/verify-live.mjs` 全 PASS（新 browser context 的干净 localStorage 会新生成 treeId，确认与持久化互不污染）
- [x] 4.5 DB 不可用降级：临时把 DATABASE_URL 指向坏地址（或停容器）验证页面仍能以空树打开、console.warn、可聊天；恢复后不影响（此项若操作成本高，可用 route 内 throw 模拟一次 GET 500 验证前端降级分支）

## 5. 文档与收尾

- [x] 5.1 `e2e/thread-chat/README.md` 补一段：持久化验收的运行方式与断言覆盖
- [x] 5.2 仓库根 `CLAUDE.md` 的「Database & thread persistence」小节末尾补 2-3 行：branch_trees 表用途（thread-chat 分支树整树 JSON）、与 threads/messages 的边界、treeId 在 localStorage
- [x] 5.3 `pnpm openspec:validate` 通过；prettier 格式化本次改动文件（提交前统一跑）
