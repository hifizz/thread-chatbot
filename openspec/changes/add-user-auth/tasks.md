# 任务拆解：登录注册 & 集成 Google（已实现，回填记录）

## 1. DB 层与认证基座

- [x] 1.1 `lib/db/auth-schema.ts` 新增 `user`/`session`/`account`/`verification` 四表（`thread_chat` schema，字段与列名遵循 better-auth 官方 drizzle 生成结果）；`pnpm db:generate` + `pnpm db:migrate` 应用
- [x] 1.2 `lib/auth/index.ts`：`betterAuth({ database: drizzleAdapter(db, ...) })` 主配置骨架；`app/api/auth/[...all]/route.ts` 用 `toNextJsHandler(auth)` 挂载全部端点
- [x] 1.3 `lib/auth/client.ts`：`createAuthClient()` 导出 `signIn`/`signUp`/`signOut`/`useSession`；`lib/auth/server.ts`：`getSession()`/`getCurrentUserId()` 供服务端/API 路由做真实鉴权

## 2. 邮箱密码 + 邮箱验证 + 找回密码

- [x] 2.1 `emailAndPassword: { enabled: true, requireEmailVerification: emailReady }`，`emailReady = isEmailConfigured()`（`lib/email/client.ts` 按 `RESEND_API_KEY` 是否配置判定）
- [x] 2.2 `lib/email/client.ts` + `lib/email/templates.ts`：Resend 封装（`sendEmail`）与验证邮件/重置密码邮件模板
- [x] 2.3 `emailVerification: { sendOnSignUp: emailReady, autoSignInAfterVerification: true, sendVerificationEmail }`；`emailAndPassword.sendResetPassword` 走同一封装
- [x] 2.4 `components/auth/auth-form.tsx`：注册/登录表单（含未验证态的「重新发送验证邮件」分支）；`app/(auth)/forgot-password`、`app/(auth)/reset-password` 页面

## 3. 反薅：延迟发放初始额度 + Turnstile

- [x] 3.1 `emailVerification.afterEmailVerification` 回调里调用 `ensureUserCredits(verifiedUser.id)`（`lib/billing/credits.ts`，幂等 `onConflictDoNothing`）——初始额度推迟到邮箱验证通过后发放
- [x] 3.2 `databaseHooks.user.create.after`：`if (!emailReady || createdUser.emailVerified) ensureUserCredits(...)`——未强制验证时（未配 Resend）注册即发；已强制验证时创建阶段不发，等验证回调
- [x] 3.3 Turnstile 插件：`captcha({ provider: "cloudflare-turnstile", secretKey: TURNSTILE_SECRET_KEY })`，仅在配置了密钥时加入 `plugins`；`components/auth/turnstile.tsx`（`turnstileEnabled` 判定、显式渲染小组件）
- [x] 3.4 `AuthForm` 提交时按 `turnstileEnabled` 决定是否要求 token、通过 `x-captcha-response` 请求头传给 better-auth；`nextCookies()` 插件置于 `plugins` 数组最后

## 4. Google 社交登录

- [x] 4.1 `lib/auth/social.ts`：`googleAuthEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)`，作为「是否启用」的单一事实来源
- [x] 4.2 `lib/auth/index.ts` 的 `socialProviders`：配齐 id/secret 时注入 `{ google: { clientId, clientSecret } }`，否则 `undefined`
- [x] 4.3 `app/(auth)/sign-in/page.tsx`、`app/(auth)/sign-up/page.tsx`（服务端组件）读取 `googleAuthEnabled`，作为 `googleEnabled` prop 传给 `AuthForm`
- [x] 4.4 `AuthForm`：`googleEnabled` 为真时渲染「使用 Google 登录/注册」按钮（`components/auth/google-icon.tsx` 内联品牌图标），调用 `authClient.signIn.social({ provider: "google", callbackURL: redirect })`
- [x] 4.5 `databaseHooks.user.create.after` 的判定条件（见 3.2）同时覆盖 Google 创建的用户——`emailVerified=true` 时创建即发放，不重复经过 `afterEmailVerification`

## 5. 页面保护中间件与会话韧性

- [x] 5.1 `proxy.ts`（Next 16 中间件更名）：`getSessionCookie` 乐观检查，`publicPages` 白名单（sign-in/sign-up/forgot-password/reset-password/terms/privacy/refund），未登录访问受保护页跳 `/sign-in?redirect=`；`matcher` 排除 `api`/静态资源
- [x] 5.2 修复死循环：`proxy.ts` 不再因「有 cookie」反向拦截 `/sign-in`/`/sign-up`；`AuthForm` 改用 `useSession()`（真查会话）判定「确属已登录」才 `router.replace(redirect)`
- [x] 5.3 新增 `lib/auth/session-recovery.ts`：`handleUnauthorized()`（进程内加锁只跳一次，best-effort `signOut()` + 硬跳 `/sign-in?redirect=`）与 `fetchWithAuth()`（包装 fetch，命中 401 触发自救、响应原样透传）
- [x] 5.4 让业务 API 的前端出口都具备 401 自愈：`lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`、`app/page.tsx`（`AssistantChatTransport` 的 `fetch`）、`app/thread-chat/net/persist.ts` 全部走 `fetchWithAuth`（含整树 GET/PUT、树列表/重命名/删除全部写路径）；`app/thread-chat/net/chat-controller.ts` 因需拿到流式 `Response` 并给出自定义错误文案，改为**手写** `if (res.status === 401) void handleUnauthorized()`（与包装器等价的自愈）；确认 better-auth 自身 `/api/auth/*` 请求未被这层覆盖（密码错误的 401 不应误触发登出跳转）

## 6. 账户入口与法务页

- [x] 6.1 `components/auth/user-menu.tsx`：主页侧栏账户入口，未登录不渲染、已登录显示头像/昵称（→ `/account`）+ 登出
- [x] 6.2 `app/thread-chat/orchestration/account-button.tsx`：`thread-chat` 顶栏账户入口，未登录显示「登录」按钮（带 `redirect` 回跳），已登录显示账户 + 登出
- [x] 6.3 `constants/legal.ts`（占位文案单一事实来源，注明需律师审阅）+ `components/legal/legal-article.tsx` + `/terms`、`/privacy`、`/refund` 页面
- [x] 6.4 `AuthForm` 注册表单加「已阅读并同意服务条款与隐私政策」勾选，未勾选阻止提交

## 7. 验收（真实执行，全绿才算完）

- [x] 7.1 `pnpm typecheck` 0 错误；`pnpm lint` 0 报错
- [x] 7.2 邮箱密码闭环：未配置 Resend 时注册即可用即得额度；配置 Resend 后注册需验证邮件、验证前无额度、验证后 `ensureUserCredits` 触发到账；忘记密码走 Resend 收到重置链接可改密
- [x] 7.3 Turnstile：配置 `TURNSTILE_SECRET_KEY` 后未完成人机验证无法提交注册/登录表单；未配置时表单不受影响
- [x] 7.4 Google 登录：配齐 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 后登录/注册页出现 Google 按钮，`signIn.social` 跳转 Google 授权、回调 `/api/auth/callback/google` 成功建会话并即时到账初始额度；未配置时按钮不出现且不影响邮箱密码路径
- [x] 7.5 会话韧性：手动清空/篡改 `session` 表数据模拟失效 cookie，验证不再出现「进不了登录页」死循环；业务 API（如 `/api/threads`）返回 401 时验证自动登出并跳转 `/sign-in?redirect=`，且登录接口本身的 401（密码错误）不触发误跳转
- [x] 7.6 中间件：未登录访问首页/`thread-chat` 跳 `/sign-in?redirect=`；已登录访问这些页面正常放行；公开页（`/terms` 等）始终可访问

## 8. 文档与收尾

- [x] 8.1 `.env.example` 补齐 `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/`RESEND_API_KEY`/`EMAIL_FROM`/`TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 及用途注释
- [x] 8.2 `README.md` 补充本地起步所需的认证相关环境变量说明
- [x] 8.3 `pnpm openspec:validate` 通过；prettier 格式化本次改动文件（提交前统一跑）
