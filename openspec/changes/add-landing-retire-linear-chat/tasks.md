# 任务拆解：落地页上线 + 退役线性聊天

## 1. 常量与契约（先立单一事实来源）

- [x] 1.1 新增 `constants/routes.ts`：`ROUTES` / `DEFAULT_AUTHED_REDIRECT` / `signInWithRedirect()`（按 design 接口）
- [x] 1.2 新增 `constants/landing.ts`：`CtaContent`/`HeroContent`/`FeatureItem`/`BranchingDemoContent`/`CanvasShowcaseContent`/`LandingContent` 类型 + `LANDING` 占位内容（文案待细化，结构以 design 为准）

## 2. 落地页组件（server，数据驱动）

- [x] 2.1 `components/landing/start-chat-button.tsx`：`StartChatButtonProps`，`next/link` + `Button`（本仓 Base UI 用 `render` 槽非 `asChild`），默认 label/href 取 `LANDING.hero.primaryCta` / `ROUTES.flagship`
- [x] 2.2 `components/landing/hero.tsx`：Hero + 主 CTA
- [x] 2.3 `components/landing/branching-demo.tsx`：划选开分支静态示意（`anchorText` 高亮 + 岔出 `branchQuestion`，纯展示不接模型）
- [x] 2.4 `components/landing/canvas-showcase.tsx`：画布工作台展示段
- [x] 2.5 `components/landing/feature-grid.tsx`：底座能力卡片（`FEATURES` 驱动，lucide-react name→component 映射）
- [x] 2.6 `components/landing/closing-cta.tsx`：收尾 CTA
- [x] 2.7 各 section 仅接 `SectionProps`（className），内容自 `LANDING` 取

## 3. 页面重写与旗舰门禁

- [x] 3.1 重写 `app/page.tsx`：移除线性聊天挂载，改为按序组合 landing 分区；落地页专属 `metadata`；server component 不读 session（build 确认 `/` 为 Static ○）
- [x] 3.2 新增 `app/thread-chat/layout.tsx`：`getSession()` 未登录 → `redirect(signInWithRedirect(ROUTES.flagship))`（包住跳板与 `[treeId]`；build 确认 `/thread-chat` 转 Dynamic ƒ）
- [x] 3.3 `components/auth/auth-form.tsx`：默认 `redirect` 由 `"/"` 改为 `DEFAULT_AUTHED_REDIRECT`（引常量）
- [x] 3.4 `proxy.ts`：把 `ROUTES.landing`（`/`）加入 `publicPages` 白名单——否则边缘乐观门禁把落地页当受保护页，登出访客访问 `/` 被弹 `/sign-in?redirect=%2F`（修复实测 bug）

## 4. 移除线性聊天栈

- [x] 4.1 删 `components/examples/base.tsx`（examples/ 空目录一并删）与其在 `app/page.tsx` 的引用（3.1 已解耦）
- [x] 4.2 删 `components/assistant-ui/tools.tsx` + `weather-tool`/`notepad-tool`/`compare-table-tool` 组件
- [x] 4.3 删 `lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`
- [x] 4.4 删 `app/api/threads/**` 路由
- [x] 4.5 grep 确认无残留 import；确认 `/api/chat`、`r2AttachmentAdapter`、`useResearchMode`、`useModelMode`、`thread-chat-prompt`、`tree-id` 未被误删

## 5. 删表与迁移

- [x] 5.1 `lib/db/schema.ts` 删 `threads`、`messages` 表定义 + 清理未用 import（`user`）；保留 `branch_trees`/`attachments`/`attachment_chunks`
- [x] 5.2 **推倒重来**（pre-launch 无数据）：清空 `drizzle/` 旧迁移 + meta，重新 `db:generate` 出全新基线 `0000_milky_ghost_rider.sql`（11 表、无 threads/messages），手动补回 `CREATE SCHEMA IF NOT EXISTS "thread_chat"` + `CREATE EXTENSION IF NOT EXISTS vector`（drizzle-kit 不生成）。⚠️ `pnpm db:migrate` 需活库，留部署/本地环境执行

## 6. 验收（真实执行，全绿才算完）

- [x] 6.1 `pnpm typecheck` 0 错；`pnpm lint` 本次改动文件 0 报（仓库存量 23 error 在未触碰的 vendored 文件，范围外）
- [x] 6.2 `pnpm build` 通过（路由表印证 `/` Static、`/thread-chat` Dynamic、`/api/threads` 已消失、`/api/chat` 保留）
- [ ] 6.3 手动验证四条链（登出访 `/` 见落地页不跳转 → CTA 未登录被弹 `/sign-in?redirect=/thread-chat` → 登录后回旗舰生成新树 → 无 redirect 参数默认落 `/thread-chat`）—— **需活服务/活库，本环境无 `.env.local` 未跑，留部署/本地**
- [ ] 6.4 旗舰 e2e 回归 `verify-live`（守护 `/api/chat` threadChat 模式）—— **需 dev server + DATABASE_URL + MiniMax key + Chromium，本环境不具备**
- [x] 6.5 `pnpm openspec:validate` 通过（`--strict`）

## 7. 文档收尾

- [x] 7.1 README「访问首页会被重定向到 /sign-in」更新为「首页见落地页；进入旗舰需登录」
- [ ] 7.2 落地页文案定稿后回填 `constants/landing.ts`（当前为占位，独立跟进——见 design Open Questions）
