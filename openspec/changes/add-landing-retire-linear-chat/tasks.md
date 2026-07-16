# 任务拆解：落地页上线 + 退役线性聊天

## 1. 常量与契约（先立单一事实来源）

- [ ] 1.1 新增 `constants/routes.ts`：`ROUTES` / `DEFAULT_AUTHED_REDIRECT` / `signInWithRedirect()`（按 design 接口）
- [ ] 1.2 新增 `constants/landing.ts`：`CtaContent`/`HeroContent`/`FeatureItem`/`BranchingDemoContent`/`CanvasShowcaseContent`/`LandingContent` 类型 + `LANDING` 占位内容（文案待细化，结构以 design 为准）

## 2. 落地页组件（server，数据驱动）

- [ ] 2.1 `components/landing/start-chat-button.tsx`：`StartChatButtonProps`，next/link + `Button` asChild，默认 label/href 取 `LANDING.hero.primaryCta` / `ROUTES.flagship`
- [ ] 2.2 `components/landing/hero.tsx`：Hero + 主 CTA
- [ ] 2.3 `components/landing/branching-demo.tsx`：划选开分支静态示意（`anchorText` 高亮 + 岔出 `branchQuestion`，纯展示不接模型）
- [ ] 2.4 `components/landing/canvas-showcase.tsx`：画布工作台展示段
- [ ] 2.5 `components/landing/feature-grid.tsx`：底座能力卡片（持久化/多模型/计费，`FEATURES` 驱动）
- [ ] 2.6 `components/landing/closing-cta.tsx`：收尾 CTA
- [ ] 2.7 各 section 仅接 `SectionProps`（className），内容自 `LANDING` 取

## 3. 页面重写与旗舰门禁

- [ ] 3.1 重写 `app/page.tsx`：移除线性聊天挂载，改为按序组合 landing 分区；落地页专属 `metadata`；server component 不读 session
- [ ] 3.2 新增 `app/thread-chat/layout.tsx`：`getSession()` 未登录 → `redirect(signInWithRedirect(ROUTES.flagship))`（包住跳板与 `[treeId]`）
- [ ] 3.3 `components/auth/auth-form.tsx`：默认 `redirect` 由 `"/"` 改为 `DEFAULT_AUTHED_REDIRECT`（引常量）

## 4. 移除线性聊天栈

- [ ] 4.1 删 `components/examples/base*` 与其在 `app/page.tsx` 的引用（3.1 已解耦）
- [ ] 4.2 删 `components/assistant-ui/tools.tsx` + `weather-tool`/`notepad-tool`/`compare-table-tool` 组件
- [ ] 4.3 删 `lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`
- [ ] 4.4 删 `app/api/threads/**` 路由
- [ ] 4.5 全仓 grep 确认无残留 import（`examples/base`/`assistant-ui/tools`/两个 adapter/`/api/threads`）；确认 `/api/chat`、`r2AttachmentAdapter`、`useResearchMode`、`useModelMode` 未被误删

## 5. 删表与迁移

- [ ] 5.1 `lib/db/schema.ts` 删 `threads`、`messages` 表定义（保留 `branch_trees`/`attachments` 等）
- [ ] 5.2 `pnpm db:generate` 生成 drop 迁移；本地 `pnpm db:migrate` 验证成功

## 6. 验收（真实执行，全绿才算完）

- [ ] 6.1 `pnpm typecheck` 0 错；`pnpm lint` 0 报
- [ ] 6.2 `pnpm build` 通过
- [ ] 6.3 手动验证四条链：登出访 `/` 见落地页不跳转 → 点 CTA 未登录被弹 `/sign-in?redirect=/thread-chat` → 登录后回旗舰生成新树 → 登录/注册无 redirect 参数默认落 `/thread-chat`
- [ ] 6.4 旗舰 e2e 回归 `verify-live`（守护 `/api/chat` threadChat 模式未受损）PASS
- [ ] 6.5 `pnpm openspec:validate` 通过

## 7. 文档收尾

- [ ] 7.1 README「用户系统」段"访问首页会被重定向到 /sign-in"更新为"访问首页见落地页；进入旗舰需登录"
- [ ] 7.2 若落地页文案定稿，回填 `constants/landing.ts`（否则留占位，独立跟进）
