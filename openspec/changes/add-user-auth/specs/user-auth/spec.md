# user-auth 登录注册 & 集成 Google

## ADDED Requirements

### Requirement: 邮箱密码注册/登录

系统 SHALL 提供邮箱密码注册与登录（`better-auth` 的 `emailAndPassword`）。是否强制邮箱验证由是否已配置邮件服务（`RESEND_API_KEY`）决定：已配置时 `requireEmailVerification` 为真，注册成功但未验证的账号不能直接登录使用；未配置时降级为「注册即用」，不阻塞本地开发。

#### Scenario: 已配置邮件服务时注册需验证

- **WHEN** 已配置 `RESEND_API_KEY` 的环境下用户提交邮箱密码注册
- **THEN** 系统 SHALL 创建账号但不直接签发可用会话（返回结果不含 token），提示用户前往邮箱完成验证

#### Scenario: 未配置邮件服务时注册即用

- **WHEN** 未配置 `RESEND_API_KEY` 的环境下用户提交邮箱密码注册
- **THEN** 系统 SHALL 直接签发可用会话，用户注册后无需邮箱验证即可使用

#### Scenario: 密码错误登录失败

- **WHEN** 用户以已存在邮箱但错误密码提交登录
- **THEN** 系统 SHALL 返回失败结果（不签发会话），前端提示错误信息，不触发会话自愈逻辑（见「业务 API 401 自愈」条的排除范围）

### Requirement: 邮箱验证与找回密码

已配置邮件服务时，系统 SHALL 在注册成功后自动发送验证邮件（`sendOnSignUp`），验证通过后自动登录（`autoSignInAfterVerification`）。系统 SHALL 提供找回密码流程：用户请求重置后收到含重置链接的邮件，通过链接可设置新密码。

#### Scenario: 注册后自动发送验证邮件

- **WHEN** 已配置邮件服务时用户完成邮箱密码注册
- **THEN** 系统 SHALL 立即发送一封含验证链接的邮件到注册邮箱

#### Scenario: 点击验证链接后自动登录

- **WHEN** 用户点击验证邮件中的链接完成验证
- **THEN** 系统 SHALL 将账号标记为已验证并自动签发可用会话，无需用户再次手动登录

#### Scenario: 请求找回密码

- **WHEN** 用户在忘记密码页面提交注册邮箱
- **THEN** 系统 SHALL 发送一封含重置链接的邮件；用户通过该链接可设置新密码并用新密码登录

### Requirement: 初始额度推迟到邮箱验证后发放

为抬高白嫖门槛，系统 SHALL 将初始额度（¥5）的发放时机与邮箱验证状态绑定：已配置邮件服务（强制验证）时，初始额度 SHALL 在邮箱验证通过（`afterEmailVerification`）之后才发放，未验证账号不得拥有可用额度；未配置邮件服务（未强制验证）时，初始额度 SHALL 在注册创建账号时即发放。额度机制本体（余额存储、扣费、充值）属计费模块，本条仅约束**发放时机**。

#### Scenario: 强制验证下未验证账号无初始额度

- **WHEN** 已配置邮件服务的环境下用户完成注册但尚未点击验证链接
- **THEN** 该账号 SHALL 不拥有初始额度记录（或余额为不可用状态），不能发起需要计费的操作

#### Scenario: 验证通过后发放初始额度

- **WHEN** 用户完成邮箱验证
- **THEN** 系统 SHALL 立即为该用户发放初始额度，此后可正常使用计费功能

#### Scenario: 未强制验证时注册即发放

- **WHEN** 未配置邮件服务的环境下用户完成注册
- **THEN** 系统 SHALL 在账号创建时立即发放初始额度

### Requirement: Turnstile 人机验证

系统 SHALL 在配置了 `TURNSTILE_SECRET_KEY` 时启用 Cloudflare Turnstile 人机验证，默认拦截 `/sign-up/email` 与 `/sign-in/email` 两个 better-auth 端点；前端通过 `x-captcha-response` 请求头把校验 token 传给服务端。未配置该环境变量时，系统 SHALL 不要求人机验证，注册/登录不受影响。

#### Scenario: 已配置密钥时未完成人机验证被拦截

- **WHEN** 已配置 `TURNSTILE_SECRET_KEY` 的环境下用户未完成 Turnstile 挑战就提交注册或登录表单
- **THEN** 系统 SHALL 阻止提交（前端校验）或服务端拒绝该请求（缺少/无效 `x-captcha-response`）

#### Scenario: 已配置密钥时完成验证后可正常提交

- **WHEN** 用户完成 Turnstile 挑战获得 token 后提交表单
- **THEN** 系统 SHALL 将 token 通过 `x-captcha-response` 头发送，服务端校验通过后正常处理注册/登录

#### Scenario: 未配置密钥时不要求人机验证

- **WHEN** 未配置 `TURNSTILE_SECRET_KEY`
- **THEN** 注册/登录表单 SHALL 不渲染 Turnstile 组件，也不因缺少 token 而被拒绝

### Requirement: Google 社交登录

系统 SHALL 在同时配置 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 时启用 Google 社交登录，判定结果的单一事实来源为 `lib/auth/social.ts` 的 `googleAuthEnabled`，不引入额外的 `NEXT_PUBLIC_` 开关。登录/注册页面 SHALL 为服务端组件，将 `googleAuthEnabled` 作为 prop 下传给客户端表单组件，用于决定是否显示「使用 Google 登录/注册」按钮。点击该按钮 SHALL 调用 `authClient.signIn.social({ provider: "google", callbackURL })` 跳转 Google 授权，授权成功后回调地址 SHALL 为 `/api/auth/callback/google`，其域名由 `BETTER_AUTH_URL` 决定且须与 Google 后台登记的重定向 URI 一致。

#### Scenario: 已配置凭据时显示 Google 登录入口

- **WHEN** 已同时配置 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET`
- **THEN** 登录页与注册页 SHALL 显示「使用 Google 登录/注册」按钮

#### Scenario: 未配置凭据时不显示入口

- **WHEN** `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 未同时配置（缺任意一个）
- **THEN** 登录页与注册页 SHALL 不显示 Google 登录入口，且服务端不注册该 provider

#### Scenario: 完成 Google 授权后建立会话

- **WHEN** 用户点击 Google 登录按钮并在 Google 完成授权
- **THEN** 浏览器 SHALL 被重定向回 `/api/auth/callback/google`，系统据此建立本地会话并跳转到发起登录前的 `callbackURL`

### Requirement: 社交登录用户额度发放对齐

系统 SHALL 保证 Google 登录创建的用户与邮箱密码注册的用户最终都能获得初始额度且不重复发放：`databaseHooks.user.create.after` SHALL 依据创建时的 `emailVerified` 字段判定——为真（Google 等已验证邮箱的社交登录）时创建即发放；为假（邮箱密码且强制验证）时创建阶段不发放，等待邮箱验证通过后的钩子发放。额度发放函数 SHALL 为幂等操作，多次调用只产生一次实际到账。

#### Scenario: Google 用户创建即发放

- **WHEN** 用户通过 Google 完成首次登录，系统创建其账号记录（`emailVerified=true`）
- **THEN** 系统 SHALL 在账号创建时立即发放初始额度，不等待任何邮箱验证步骤

#### Scenario: 双路径不重复发放

- **WHEN** 因幂等实现的边界情况，发放函数针对同一用户被调用了不止一次
- **THEN** 该用户的初始额度记录 SHALL 只被创建一次，余额不因多次调用而重复累加

### Requirement: 页面保护中间件

系统 SHALL 在 `proxy.ts`（Next 16 中间件命名约定）中对页面路由做乐观会话检查：仅检查会话 cookie 是否存在（不查库），存在公开页白名单（登录、注册、忘记密码、重置密码、服务条款、隐私政策、退款政策）。未登录（无会话 cookie）访问白名单之外的页面时，系统 SHALL 重定向到 `/sign-in` 并在查询参数 `redirect` 中携带原始路径；中间件 SHALL 不拦截 API 路由与静态资源。

#### Scenario: 未登录访问受保护页面

- **WHEN** 无会话 cookie 的请求访问首页或 `/thread-chat`
- **THEN** 系统 SHALL 重定向到 `/sign-in?redirect={原路径}`

#### Scenario: 已登录访问受保护页面

- **WHEN** 携带有效会话 cookie 的请求访问受保护页面
- **THEN** 中间件 SHALL 放行（不做进一步查库校验，真实校验交给页面/API 自身）

#### Scenario: 未登录访问公开页面

- **WHEN** 无会话 cookie 的请求访问 `/sign-in`、`/terms` 等公开页面
- **THEN** 中间件 SHALL 直接放行，不重定向

### Requirement: 登录页真实会话兜底跳转

为避免「乐观中间件因误判把已登录用户挡在登录页之外」与「因失效 cookie 被反向弹离登录页导致死循环」，中间件 SHALL 不因「存在 cookie」而对登录/注册页做反向拦截跳转；登录页 SHALL 使用 `useSession()`（发起真实会话查询）判定用户确属已登录后，才由客户端 `router.replace` 跳转到目标地址。

#### Scenario: 会话确实有效时自动跳走

- **WHEN** 已登录用户（拥有有效会话）访问 `/sign-in`
- **THEN** 页面 SHALL 通过 `useSession()` 确认会话有效后，客户端跳转到 `redirect` 参数指定的地址（默认 `/`）

#### Scenario: cookie 失效时留在登录页

- **WHEN** 浏览器携带一张已失效的会话 cookie（如会话被撤销、数据库会话被清空）访问 `/sign-in`
- **THEN** `useSession()` SHALL 返回空会话，页面 SHALL 不跳转，用户可正常填写表单重新登录，不出现「进不了登录页」的死循环

### Requirement: 业务 API 401 自愈

业务 API（threads、chat、history、branch-trees 等非 better-auth 自身接口）返回 401 时，客户端 SHALL 触发 `handleUnauthorized()`：尽力调用登出以清除本地失效会话 cookie，随后硬跳转到 `/sign-in` 并携带当前路径作为 `redirect` 参数。触发方式 SHALL 为 `fetchWithAuth` 包装（threads/history/branch-trees 的读写、主聊天 transport），或在需要保留流式 `Response` 与自定义错误文案的路径（thread-chat 的 `/api/chat` 控制器）上以等价的 `if (401) handleUnauthorized()` 手写实现。该机制 SHALL 仅包裹业务 API 请求，SHALL NOT 包裹 better-auth 自身的 `/api/auth/*` 接口（避免将登录失败等正常业务 401 误判为会话失效）。并发多个 401 SHALL 只触发一次登出与跳转。

#### Scenario: 业务 API 会话失效时自动跳转

- **WHEN** 用户在已登录状态下操作页面，中途会话失效，随后对 `/api/threads` 等业务接口的请求返回 401
- **THEN** 客户端 SHALL 尽力登出清除本地 cookie，并硬跳转到 `/sign-in?redirect={当前路径}`

#### Scenario: 并发多个 401 只跳转一次

- **WHEN** 会话失效期间同时有多个业务请求各自返回 401
- **THEN** 系统 SHALL 只执行一次登出与跳转，不重复触发

#### Scenario: 登录接口自身的 401 不触发自愈

- **WHEN** 用户在登录表单提交错误密码，`/api/auth/sign-in/email` 返回 401
- **THEN** 系统 SHALL NOT 触发 `handleUnauthorized`，仅按登录失败正常提示错误信息

### Requirement: 账户入口

系统 SHALL 在主页侧栏与 `thread-chat` 顶栏分别提供账户入口。未登录时，`thread-chat` 顶栏 SHALL 显示「登录」按钮（带回跳地址），主页侧栏入口 SHALL 不渲染；已登录时两处入口 SHALL 显示用户标识（昵称或邮箱）并提供跳转到账户页与登出操作。

#### Scenario: 未登录时的顶栏入口

- **WHEN** 未登录用户访问 `/thread-chat`
- **THEN** 顶栏 SHALL 显示「登录」按钮，点击后跳转 `/sign-in` 并携带当前路径为 `redirect`

#### Scenario: 已登录时的账户入口

- **WHEN** 已登录用户访问主页或 `/thread-chat`
- **THEN** 侧栏（主页）与顶栏（`thread-chat`）SHALL 显示当前用户标识，提供进入账户页与登出的操作

#### Scenario: 登出

- **WHEN** 已登录用户点击登出按钮（侧栏或顶栏任一入口）
- **THEN** 系统 SHALL 清除会话并跳转到 `/sign-in`

### Requirement: 法务页存在与注册同意勾选

系统 SHALL 提供 `/terms`（服务条款）、`/privacy`（隐私政策）、`/refund`（退款政策）三个法务页面，内容来自 `constants/legal.ts` 的模板占位文案。注册表单 SHALL 要求用户勾选「已阅读并同意服务条款与隐私政策」后才能提交注册。本条仅登记这些页面与勾选交互的存在，不对文案内容的合规性做任何保证——文案为通用模板，上线前须交由法务/律师审阅替换占位信息。

#### Scenario: 法务页可访问

- **WHEN** 任意用户（无论登录状态）访问 `/terms`、`/privacy` 或 `/refund`
- **THEN** 系统 SHALL 正常渲染对应页面内容，不要求登录

#### Scenario: 未勾选同意无法注册

- **WHEN** 用户填写完注册表单但未勾选同意服务条款与隐私政策
- **THEN** 系统 SHALL 阻止提交并提示需先同意条款
