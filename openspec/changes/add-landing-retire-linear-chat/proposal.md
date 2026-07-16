# 落地页上线：`/` 改为公开 landing，退役 assistant-ui 线性聊天

## Why

项目要上线，但 `/` 现在是 assistant-ui 的**线性聊天**（`app/page.tsx` 挂 `Base`）——那是模板遗留，不是要主推的产品。真正差异化的旗舰是 `/thread-chat`（划选 AI 回复即开分支的树状/画布对话）。上线需要 `/` 变成一张**公开获客落地页**把访客引导进旗舰，并把线性聊天作为遗产整套移除，不再维护两套聊天栈。移除是低风险的：线性与 thread-chat 的持久化/适配层完全独立（`threads`/`messages` 表 vs `branch_trees` 表），线性 UI 只挂在 `/` 一处，唯一共享点 `/api/chat`（threadChat 模式复用）予以保留。

## What Changes

- **`/` 重写为公开 landing 页**：Hero + 主 CTA「开始聊天」+ 卖点段落（划选开分支、画布工作台、底座能力）。内容**数据驱动**（`constants/landing.ts`），视觉/文案后续可独立细化而不动结构。页面**不做鉴权**（获客页需登出可见、可 CDN 缓存）。
- **落地页 `/` 从 `proxy.ts` 白名单放行**：项目有边缘乐观门禁 `proxy.ts`（Next 16 的 middleware），默认把非白名单页当受保护页；`/` 须加入 `publicPages`，否则登出访客访问 `/` 被弹登录。
- **旗舰 `/thread-chat` 保持不改名**，新增服务端 `app/thread-chat/layout.tsx` 叠真校验：`getSession()` 未登录 → `redirect("/sign-in?redirect=/thread-chat")`。与 `/account` 现有写法同构（受保护页 = proxy 乐观拦 + 页面 getSession 真校验双层）。
- **登录/注册默认落点从 `/` 改为 `/thread-chat`**：`components/auth/auth-form.tsx` 的 `params.get("redirect") || "/"` 默认值改引路由常量。
- **BREAKING** 彻底移除线性聊天栈及其数据表：
  - `app/page.tsx` 的线性挂载（被 landing 取代）
  - `components/examples/base`、`components/assistant-ui/tools.tsx` + `weather`/`notepad`/`compare-table` 三个 demo 工具组件
  - `lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`
  - `app/api/threads/**` 路由
  - `threads` + `messages` 两张表（删 `lib/db/schema.ts` 定义 + 出一条 drop 迁移；pre-launch 无生产数据）
- **不含**：landing 的最终视觉稿/文案打磨（结构已数据驱动，留独立细化）；旗舰改名到 `/chat`（已决定保留品牌名 `/thread-chat`）；`/api/chat`、`attachments`、`branch_trees`、billing、auth、account 任何改动。

## Capabilities

### New Capabilities

- `landing-page`: 公开落地页——Hero/主 CTA/卖点段落、数据驱动内容、CTA 指向旗舰、页面无鉴权可缓存。
- `flagship-access`: 旗舰访问门禁——`/thread-chat/**` 服务端 layout gating、未登录跳登录带 `redirect`、登录/注册默认落点为旗舰。

### Modified Capabilities

（无。线性聊天从未沉淀为基线 spec，其退役以移除清单落在 tasks/design，不产生 spec delta。）

## Impact

- `app/page.tsx`（线性挂载 → landing 组合，重写）
- `app/thread-chat/layout.tsx`（**新增**，服务端 gating，~15 行）
- `components/landing/*`（**新增**：`hero` / `branching-demo` / `canvas-showcase` / `feature-grid` / `closing-cta` / `start-chat-button`）
- `constants/landing.ts`（**新增**，内容 + 类型）、`constants/routes.ts`（**新增**，路由与默认落点单一事实来源）
- `components/auth/auth-form.tsx`（默认 `redirect` 落点，引用常量）
- `proxy.ts`（`publicPages` 加入 `ROUTES.landing`，放行落地页）
- **删除**：`components/examples/base*`、`components/assistant-ui/tools.tsx` + `weather-tool`/`notepad-tool`/`compare-table-tool`、`lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`、`app/api/threads/**`
- `lib/db/schema.ts`（删 `threads`/`messages` 定义）+ `drizzle/`（新增 drop 迁移）
- **不改**：`app/api/chat/route.ts`（threadChat 模式共用）、`app/thread-chat/**` 业务代码、`branch_trees`/`attachments`、billing/auth/account
