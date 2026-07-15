# 登录注册 & 集成 Google（用户体系 + 反薅 + 会话韧性）

## Why

计费模块（额度/充值）需要一个「用户」才能挂账，对话历史、分支树也终将要按用户隔离——本仓库此前完全没有用户体系，任何人打开页面都在共享同一份匿名数据。补上登录注册是把产品从 demo 推向可计费产品的前置地基。同时，「注册即赠送初始额度」在没有任何门槛的情况下就是白薅入口，必须与反薅措施（邮箱验证、人机验证）一起设计，而不是先上线再补。国内外用户都有，社交登录（Google）能显著降低注册摩擦，因此与账号密码体系一并设计而非后补。

## What Changes

- 引入 **better-auth** 作为认证框架（drizzleAdapter 接现有 Postgres），新增 `user`/`session`/`account`/`verification` 四张表，catch-all 路由 `/api/auth/[...all]` 托管全部端点。
- **邮箱密码注册/登录**：配置了 Resend（`RESEND_API_KEY`）时强制邮箱验证，否则本地开发降级为「注册即用」。
- **邮箱验证与找回密码**：注册自动发验证邮件、`autoSignInAfterVerification`；忘记密码走 Resend 发重置链接。
- **反薅关键决策**：初始额度（¥5）从「注册即发」改为「邮箱验证通过后才发」，抬高白嫖门槛；额度机制本体属计费模块，这里只改**发放时机**。
- **人机验证（Cloudflare Turnstile）**：配置了 `TURNSTILE_SECRET_KEY` 才启用，默认拦截 `/sign-up/email` 与 `/sign-in/email`。
- **Google 社交登录（本次新增）**：同时配齐 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 即启用，无需额外 `NEXT_PUBLIC` 开关；登录/注册页（服务端组件）把判定结果作为 prop 下传客户端表单。
- **社交登录额度发放对齐**：Google 邮箱创建时已是 `emailVerified=true`，不会走验证后钩子，改为在 `user.create.after` 按 `emailVerified` 分流发放，`ensureUserCredits` 幂等保证两条路径不重复发。
- **页面保护中间件**：`proxy.ts`（Next 16 中间件更名）做乐观 cookie 检查，公开页白名单放行，未登录访问受保护页跳 `/sign-in?redirect=`。
- **会话韧性修复**（记为约定，不是新特性）：修掉「乐观中间件 + 失效 cookie」造成的登录死循环——中间件不再乐观地把「有 cookie」的用户弹离登录页，改由登录页 `useSession` 真查会话后再跳；新增 `fetchWithAuth`/`handleUnauthorized`，业务 API 401 时自动登出清 cookie 并跳回登录页。
- **账户入口**：主页侧栏 `UserMenu`、`thread-chat` 顶栏 `AccountButton`，未登录显示登录、已登录显示账户/登出。
- **法务页登记**：`/terms` `/privacy` `/refund`（模板文案，需律师审阅），注册表单需勾选同意条款。

## Capabilities

### New Capabilities

- `user-auth`：邮箱密码与 Google 社交登录、邮箱验证/找回密码、反薅（初始额度延迟发放 + Turnstile）、页面保护中间件、登录页真实会话兜底、业务 API 401 自愈、账户入口、法务页登记。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本仓库尚无既有 spec；本变更不修改任何既有能力的需求级行为。）

## Impact

- **DB**：`lib/db/auth-schema.ts` 新增 `user`/`session`/`account`/`verification` 四表（`thread_chat` schema，字段遵循 better-auth 官方 drizzle 生成结果）。
- **认证配置**：`lib/auth/index.ts`（betterAuth 主配置）、`lib/auth/social.ts`（Google 判定单一事实来源）、`lib/auth/client.ts`（浏览器端）、`lib/auth/server.ts`（服务端读会话）、`lib/auth/session-recovery.ts`（401 自愈）。
- **路由**：`app/api/auth/[...all]/route.ts`（better-auth catch-all）、`proxy.ts`（页面保护中间件）。
- **页面**：`app/(auth)/sign-in|sign-up|forgot-password|reset-password/page.tsx`（服务端组件，下传 `googleAuthEnabled`）、`components/auth/auth-form.tsx`、`components/auth/turnstile.tsx`、`components/auth/google-icon.tsx`、`components/auth/user-menu.tsx`、`app/thread-chat/orchestration/account-button.tsx`。
- **法务**：`constants/legal.ts`、`components/legal/legal-article.tsx`、`/terms` `/privacy` `/refund` 页面。
- **计费交叉引用**：`lib/billing/credits.ts` 的 `ensureUserCredits`（幂等发放初始额度）；本变更只改**调用时机**，额度机制本体见计费模块的 change。
- **既有前端 fetch 接入 401 自愈**：`lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`、`app/page.tsx`（`AssistantChatTransport` 的 `fetch`）、`app/thread-chat/net/chat-controller.ts`、`app/thread-chat/net/persist.ts`。
- **运行前提**：`.env.local` 需 `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`；`RESEND_API_KEY`/`TURNSTILE_SECRET_KEY`/`GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET` 均为可选——未配置时各自降级，不阻塞本地开发。
