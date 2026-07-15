# 设计：登录注册 & 集成 Google

## Context

- 仓库此前无任何用户体系：`app/page.tsx`（主聊天）与 `app/thread-chat/`（分支对话树）的持久化都不区分用户，任何访问者共享同一份数据。计费模块（`lib/billing/credits.ts` 的 `userCredits`/`usageRecords`/`payments`）已经落地并以 `userId` 建模，正等着一个真实的用户体系接入。
- 已有 Postgres + Drizzle 基建（`lib/db/index.ts` 全局单例客户端、`lib/db/schema.ts`、`drizzle/` 迁移）可直接复用给认证表，无需新起数据源。
- 产品面向国内外用户，账号密码是必需的基线，但社交登录（尤其 Google）能显著降低海外/移动端用户的注册摩擦，因此从一开始就与账号密码一起设计，而不是先上线纯密码体系再补社交登录（补社交登录会牵动额度发放时机的判定逻辑，事后改动面更大）。
- 「注册即赠送初始额度」是显而易见的白嫖入口：任何允许免费注册就拿到可用额度的产品都会被脚本批量注册。反薅不是可选项，必须与登录注册同批设计。
- Next 16 把 `middleware.ts` 约定重命名为 `proxy.ts`（同签名），本项目按新约定命名。

## Goals / Non-Goals

**Goals:**

- 邮箱密码注册/登录闭环（含验证、找回密码），在未配置邮件服务的本地开发环境也能顺畅使用（降级而非报错）。
- 初始额度发放前置反薅门槛（邮箱验证），且门槛在 Turnstile 配置后进一步抬高。
- Google 社交登录作为账号密码的平等入口，配置存在即启用，不引入额外的功能开关变量。
- 两条注册路径（邮箱密码 / Google）最终都能拿到初始额度且不重复发放。
- 页面级保护足够便宜（Edge 乐观检查），且不会把用户锁进「有 cookie 但会话已失效」的死循环。
- 业务 API 遇到会话失效时能自动引导用户重新登录，而不是让页面卡死在一堆无声的 401 里。

**Non-Goals:**

- 手机号登录、其他社交登录（微信/GitHub 等）——架构上 `socialProviders` 可平行扩展，本次只接 Google。
- 邮箱验证/Turnstile 的强制开启（是否配置是环境变量决定的运维选择，本次只保证「配了就生效、没配就降级」）。
- 法务文案的合规审阅——`constants/legal.ts` 是模板占位，注明需律师审阅，不在本变更的工程范围内。
- 会话韧性方面的更大特性（如多设备会话管理、强制下线其他会话）——本次只修复「乐观中间件 + 失效 cookie」这一个已知死循环，其余留待需要时再做。

## Decisions

### D1：选择 better-auth（drizzleAdapter + 插件生态）

**选择**：认证框架用 better-auth 1.6.23，`drizzleAdapter` 接现有 Postgres；邮箱密码走内置 `emailAndPassword`，社交登录走内置 `socialProviders`，人机验证走官方 `captcha` 插件，Next App Router 适配走官方 `nextCookies` 插件。

**理由**：项目已经是 Drizzle + Postgres 技术栈，better-auth 的 drizzle adapter 零额外基建；邮箱密码、邮箱验证、找回密码、社交登录、captcha 都是官方插件而非自研，工程量集中在「接线」而非「重新发明认证」。相比 NextAuth/Auth.js，better-auth 对 Drizzle schema 的控制粒度更细（表结构直接是仓库自己的 `lib/db/auth-schema.ts`，可读可控），且插件化的 `afterEmailVerification`/`databaseHooks` 钩子正好承载反薅逻辑，不需要绕开框架写 hack。

**弃选**：自建 JWT + 密码哈希——认证是极易踩坑的领域（会话失效、CSRF、密码重置 token 时效），没有理由不用经过验证的框架；NextAuth——对「注册流程钩子」（发放额度、反薅）的控制不如 better-auth 直接。

### D2：反薅分层——延迟发放 + Turnstile + 环境变量门控降级

**选择**：三层防线叠加，且每层都「按环境变量门控，未配置时自动降级为更宽松的行为」：
1. 初始额度发放从「注册即发」改为「`emailVerification.afterEmailVerification` 回调里发」（仅在 `requireEmailVerification=true`，即配置了 Resend 时生效）。
2. Cloudflare Turnstile 拦截 `/sign-up/email` 与 `/sign-in/email`，仅在配置了 `TURNSTILE_SECRET_KEY` 时启用（`captcha` 插件）。
3. 未配置 Resend 时 `requireEmailVerification=false`，退化为「注册即用」；未配置 Turnstile 时不校验人机验证 token。

**理由**：反薅措施天然依赖第三方服务（邮件发送、人机验证网关），本地开发和早期上线不一定已经申请齐全这些凭据——如果强制要求配置齐全才能跑起来，会拖慢开发迭代与首次部署。用「配了就生效、没配就降级」而不是「配了就报错阻塞」，把反薅强度和运维成熟度解耦：开发环境宽松高效，生产环境把三个环境变量配齐即可拿到设计中的全部反薅强度，无需改代码。

**弃选**：注册即发但设置人工审核——引入运营负担，与「即时可用」的产品体验冲突；仅靠 Turnstile 不改发放时机——Turnstile 挡的是脚本批量注册，挡不住「人工小号邮箱批量注册后即时套现额度」这类慢速薅法，必须两层都上。

### D3：Google 社交登录——配齐 id/secret 即启用，无 `NEXT_PUBLIC` 开关

**选择**：单一事实来源 `lib/auth/social.ts` 导出 `googleAuthEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)`。`lib/auth/index.ts` 的 `socialProviders` 与登录/注册页是否显示 Google 按钮，都从这一处判定读取。登录页（`app/(auth)/sign-in/page.tsx`、`sign-up/page.tsx`）是**服务端组件**，直接 import `googleAuthEnabled`（能读到服务端专属的 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`），把结果作为 `googleEnabled` prop 下传给客户端组件 `AuthForm`。

**理由**：客户端组件无法读取非 `NEXT_PUBLIC_` 前缀的环境变量（构建期就被裁剪掉），而 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 是服务端凭据，不应该加 `NEXT_PUBLIC_` 前缀暴露出去。服务端组件不受此限制，天然可以在渲染时把「是否启用」这个布尔值算好，作为 props 传给下游客户端组件——这是 App Router 里「服务端持有密钥、客户端持有展示状态」的标准分工，不需要额外的运行时请求或 hydration 技巧。

**弃选**：额外声明一个 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` 开关——这会制造第二个「是否启用」的事实来源，一旦运维只改了 `GOOGLE_CLIENT_ID`/`SECRET` 忘记同步这个开关（或反过来），前端显示状态与后端实际启用状态就会漂移（按钮显示但后端 404，或按钮不显示但后端其实能登录），比多传一个 prop 的成本更高。

### D4：初始额度发放时机对齐社交登录（`emailVerified` 判定 + 幂等）

**选择**：`databaseHooks.user.create.after` 里判定 `if (!emailReady || createdUser.emailVerified) { ensureUserCredits(createdUser.id) }`。Google 登录创建的用户在 better-auth 写库时 `emailVerified` 已经是 `true`（社交提供方已验证邮箱），因此创建即满足条件、当场发放，不会经过 `afterEmailVerification`；邮箱密码注册的用户创建时 `emailVerified=false`（在 `requireEmailVerification=true` 的前提下），要等验证回调才发。`ensureUserCredits` 内部用 `onConflictDoNothing({ target: userCredits.userId })` 保证幂等——即便某条路径未来被误触发两次，也只会创建一行、不会重复发放。

**理由**：两条注册路径（邮箱密码、Google）走的是 better-auth 内部不同的钩子时序（前者会触发 `afterEmailVerification`，后者不会），如果只在 `afterEmailVerification` 里发额度，Google 用户永远拿不到初始额度；如果无条件在 `create.after` 里发，又会绕过邮箱密码路径的反薅门槛（D2 的核心防线）。用 `emailVerified` 这一个字段做统一判定，两条路径共享同一条决策规则，不需要为社交登录单独写一份发放逻辑。

**弃选**：`create.after` 无条件发放——最简单但直接废掉 D2 的反薅设计，任何人用假邮箱注册也能秒得额度；为社交登录单独写一个「provider === google 就发」的分支——本质是同一个判定的另一种写法，但引入了「provider 白名单」这个新的维护点（未来加微信登录还要记得改这里），不如复用 `emailVerified` 这一个已经存在、语义准确的字段。

### D5：乐观中间件 vs 真实校验（防 401 死循环的约定）

**背景**：早期实现里 `proxy.ts` 除了「未登录挡受保护页」，还反向做了「有 cookie 就把访问 `/sign-in` 的用户弹回首页」。这在 cookie 失效（会话过期、被撤销、用户被删、本地开发库被重置导致的 session 表清空）时会产生死循环：中间件看到 cookie 存在就不让进登录页，但那张 cookie 其实换不来任何有效会话，所有业务 API 都返回 401——用户进不了登录页、也用不了任何功能，且没有自愈路径。

**选择（记为约定，供后人加受保护路由时遵守）**：`proxy.ts` 只做**乐观 cookie 存在性检查**（`getSessionCookie`，不查库），职责收窄为「没 cookie 就别进受保护页」这一个方向；**不再**因为「有 cookie」就对 `/sign-in`/`/sign-up` 做反向拦截跳转。真实的会话有效性校验下放到两处：① 各 API 路由内用 `lib/auth/server.ts` 的 `getSession()`/`getCurrentUserId()` 做真实鉴权；② 登录页 `AuthForm` 用 `useSession()`（真查 `/api/auth/get-session`）判定「确属已登录」才 `router.replace(redirect)` 跳走，cookie 失效则 `useSession` 返回空、用户正常留在登录页重新登录。

**理由**：中间件跑在 Edge、要求低延迟，查库校验会话不划算，这是「乐观检查」存在的原因，不能因为要修死循环就把它改成同步查库。但乐观检查只能安全地用在「宁可漏过（放行了实际已过期的会话去受保护页，反正业务 API 会再挡一次）」的方向，不能用在「宁可错杀」的方向——错杀的后果是把用户挡在唯一能修复问题的页面（登录页）之外，而这个方向偏偏没有下游兜底。这条是给后人加受保护路由/页面时的必知约定：中间件只负责「没 cookie 必挡」，任何「弹离某页面」的逻辑都不该建立在乐观 cookie 检查之上。

**弃选**：中间件里查库校验 session——为了修一个边缘场景牺牲每次页面导航的延迟，不值；保留反向拦截但加白名单例外——治标不治本，白名单会随受保护页面增多而不断打补丁。

### D6：401 自愈——只包业务 API，不包 better-auth 自身接口

**选择**：新增 `lib/auth/session-recovery.ts`：`fetchWithAuth(input, init)` 包装 `fetch`，命中响应状态 401 时触发 `handleUnauthorized()`（best-effort 调用 `signOut()` 清掉本地已知失效的 cookie，随后硬跳转 `window.location.href = /sign-in?redirect=...`），响应本身原样返回给调用方（不吞掉，不改变既有错误处理路径）。用进程内 `let recovering = false` 加锁，确保并发多个 401 只触发一次登出+跳转。接入范围：`lib/chat/thread-list-adapter.ts`、`lib/chat/use-thread-history-adapter.ts`、`app/page.tsx` 里 `AssistantChatTransport` 的 `fetch`、`app/thread-chat/net/chat-controller.ts`、`app/thread-chat/net/persist.ts`——即所有会话相关的业务数据读写。

**理由**：D5 修的是「中间件不再错误地挡住登录页」，但没有解决「用户已经打开着受保护页面、会话在使用过程中失效」这种场景——此时页面不会重新经过中间件，只会看到业务 API 陆续返回 401 且大多数前端代码对 401 没有特殊处理（表现为静默失败或控制台报错）。`fetchWithAuth` 把「拿到 401」到「登出并引导重新登录」这条恢复路径做成通用包装，接入各处业务 fetch 即可。**刻意排除** better-auth 自身的 `/api/auth/*` 接口：登录表单提交密码错误时同样会拿到 401，如果这个包装也覆盖了登录请求本身，就会把一次正常的「密码错了、请重试」误判成「会话失效」，触发不必要的 `signOut()` 和跳转，形成体验上的另一种死循环。

**弃选**：全局 fetch 拦截（如 monkey-patch `window.fetch`）——覆盖面不可控，会连带拦到 better-auth 自身请求，需要额外做 URL 白名单排除，比显式在业务 fetch 调用点替换成 `fetchWithAuth` 更难审计、更易踩到上面说的误跳转问题。

### D7：回调域名与插件顺序

**选择**：Google OAuth 回调地址 `/api/auth/callback/google` 的域名由 `BETTER_AUTH_URL` 环境变量决定（better-auth 用它拼出完整回调 URL），必须与 Google Cloud Console 后台配置的「已获授权的重定向 URI」完全一致，否则 Google 会拒绝回调。`lib/auth/index.ts` 里 `nextCookies()` 插件必须放在 `plugins` 数组最后。

**理由**：`BETTER_AUTH_URL` 是本项目里「站点对外地址」的唯一事实来源（`.env.example` 已注明本地为 `http://localhost:3000`），回调域名跟着它走而不是硬编码，换环境（本地/预览/生产）只需要改这一个变量。`nextCookies()` 是 better-auth 官方文档明确要求的顺序约束——它负责在 Next App Router 的路由处理器/Server Action 里把 `Set-Cookie` 写回响应，如果它不是最后一个插件，后面插件对响应的修改可能不会被正确落到 cookie 里；这是框架约束而非本项目设计决策，记录下来是为了不让后人在新增插件时把顺序打乱。

## Risks / Trade-offs

- **[环境变量降级链路多]** → Resend/Turnstile/Google 三者任一缺失都会让本地开发环境的行为与生产不同（验证要求、人机验证、Google 按钮显示与否）。接受：开发效率优先，`.env.example` 已注明每个变量的作用与「未配置时会怎样」，上线前检查清单里应包含「三者是否已配置」。
- **[Google 邮箱验证信任第三方]** → `emailVerified=true` 完全信任 Google 的验证结果，如果 Google 账号本身是一次性邮箱注册的低质量账号，反薅门槛对这条路径实际上形同虚设（Google 登录不经过邮箱验证，也不经过 Turnstile，因为 Turnstile 目前只挂在 `/sign-up/email` 与 `/sign-in/email`）。接受：Google OAuth 本身有一定的注册成本（需要真实 Google 账号），作为权衡；若未来发现 Google 路径被滥用，可以给 `signIn.social` 加单独的速率限制，不在本次范围内。
- **[401 自愈的硬跳转会丢失未保存的本地状态]** → `fetchWithAuth` 命中 401 后用 `window.location.href` 硬跳转（而非 `router.push`），意在让中间件用最新（已清除）的 cookie 重新判定，但硬跳转会丢弃客户端内存态（如正在编辑但未保存的分支树防抖写入）。接受：会话失效本就意味着后续写入也会失败，与其让用户继续在一个「看起来正常、实际上写不进去」的页面里操作，不如尽快引导重新登录；分支树防抖写入见 `add-branch-tree-persistence` 的卸载 flush 设计，属独立机制。
- **[乐观中间件仍可能放行过期会话到受保护页]** → D5 明确接受这一点，由页面内的业务 API 401 + `fetchWithAuth` 兜底，不是安全边界的漏洞（受保护页面本身的数据读写仍然经过服务端 `getSession()` 真实校验）。

## Migration Plan

1. 认证表（`user`/`session`/`account`/`verification`）随 `pnpm db:generate`/`pnpm db:migrate` 常规迁移流程建表，纯新增、不触碰既有表。
2. 环境变量按需追加：`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`（必需）；`RESEND_API_KEY`/`EMAIL_FROM`（邮箱验证/找回密码）；`TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY`（人机验证）；`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`（社交登录）——均可分批配置，不要求一次到位。
3. Google OAuth 需在 Google Cloud Console 创建 OAuth 客户端，把 `{BETTER_AUTH_URL}/api/auth/callback/google` 登记为授权重定向 URI。
4. 回滚：四张认证表与业务表无外键耦合（`userCredits` 等表引用 `user.id` 但属于计费模块的 change），revert 提交即可；已注册用户数据保留在库中不受影响。

## Open Questions

（无——范围内的决策已全部定案。会话韧性方面更大的特性（多设备会话管理等）留待有实际需要时再单独提出 change。）
