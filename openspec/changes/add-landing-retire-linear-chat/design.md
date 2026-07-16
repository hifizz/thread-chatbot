# 设计：落地页上线 + 退役线性聊天

## Context

- **现状**：`/` = `app/page.tsx` 挂 assistant-ui 线性聊天（`Base` + `AssistantTools` + 三个 demo 工具 + `postgresThreadListAdapter` + `usePostgresThreadHistoryAdapter`），持久化走 `threads`/`messages` 表与 `/api/threads/*`。旗舰 `/thread-chat`（跳板 `page.tsx`）+ `/thread-chat/[treeId]`（`ThreadChatDemo`）走独立的 `branch_trees` 表。两套持久化零耦合。
- **共享点（唯一）**：`/api/chat`——thread-chat 的 threadChat 模式复用它（`app/thread-chat/net/*`）。**必须保留**。
- **鉴权现状（两层）**：项目**有** `proxy.ts`（Next 16 把 middleware 约定重命名为 proxy）做**边缘乐观 cookie 门禁**——除 `publicPages` 白名单（sign-in/sign-up/找回密码/法务页）外的所有页面路由，无 session cookie 即 302 到 `/sign-in?redirect={pathname}`；它**不查库**（注释"中间件只做乐观 cookie 检查/不再乐观弹走登录页"指的正是它，不是"已撤除"）。之上，`/account` 再叠一层服务端真校验：`getSession()` → `redirect("/sign-in?redirect=/account")`。即受保护页 = **proxy 乐观拦 + 页面 getSession 真校验** 双层。旗舰目前只被 proxy 拦、无页面级真校验，且 `/` 因不在 proxy 白名单而被当作受保护页。
- **约束**：CLAUDE.md——常量进 `constants/` 分主题文件、共享工具按域进 `lib/`、中文输出、Tailwind v4 CSS-first、shadcn 基于 Base UI（`components/ui/*`）。旗舰两个 page 均为 server component，可被 server `layout.tsx` 干净包裹。

## Goals / Non-Goals

**Goals:**

- `/` 变公开落地页，主推 thread-chat 差异化；线性聊天栈及其表整套删净。
- 旗舰加服务端 gating（与 `/account` 同构），登录默认落点转向旗舰。
- 落地页内容数据驱动——后续视觉/文案细化不改结构。
- 移除零波及旗舰/billing/auth/attachments，`/api/chat` 不动。

**Non-Goals:**

- 落地页最终视觉稿/文案打磨（本变更只立数据驱动的骨架与占位文案）。
- 旗舰改名 `/chat`（已决定保留品牌名）。
- 精确 `[treeId]` 回跳（门禁跳裸 `/thread-chat`，见 D2）。
- 移动端落地页专属版式（沿用响应式，不单列）。

## 模块接口与关键类型（先定契约）

> 先钉死模块边界与 TS 类型，实现阶段照此填肉。所有新组件默认 **server component**（落地页保持静态可缓存），标注 client 的才是 client。

### 模块/目录结构

```
constants/
  routes.ts          【新】路由 + 默认落点单一事实来源
  landing.ts         【新】落地页内容 + 内容类型
components/landing/   【新】落地页分区组件（server）
  hero.tsx
  branching-demo.tsx
  canvas-showcase.tsx
  feature-grid.tsx
  closing-cta.tsx
  start-chat-button.tsx
app/
  page.tsx           【改】线性挂载 → 落地页组合（server）
  thread-chat/
    layout.tsx       【新】服务端 gating（包住跳板与 [treeId]）
components/auth/
  auth-form.tsx      【改】默认 redirect 落点引常量
```

### `constants/routes.ts` —— 路由与登录后落点

```ts
/** 应用路由单一事实来源——避免 "/thread-chat" 字面量散落在 CTA/门禁/auth-form。 */
export const ROUTES = {
  landing: "/",
  flagship: "/thread-chat", // 旗舰跳板（裸路径 → /thread-chat/{uuid}）
  signIn: "/sign-in",
  account: "/account",
} as const

export type RouteKey = keyof typeof ROUTES

/** 登录/注册成功且 URL 无 redirect 参数时的默认落点。 */
export const DEFAULT_AUTHED_REDIRECT: string = ROUTES.flagship

/** 构造带回跳的登录地址（redirect 目标做 URL 编码）。 */
export function signInWithRedirect(target: string): string {
  return `${ROUTES.signIn}?redirect=${encodeURIComponent(target)}`
}
```

### `constants/landing.ts` —— 内容类型 + 数据

```ts
/** 一个 CTA：文案 + 目标路由（默认应指向 ROUTES.flagship）。 */
export interface CtaContent {
  label: string
  href: string
}

export interface HeroContent {
  eyebrow?: string // 顶部小标签（可选）
  title: string // 主标题
  subtitle: string // 一句话价值主张
  primaryCta: CtaContent
}

export interface FeatureItem {
  icon?: string // lucide-react 图标名或 emoji，由渲染层解释
  title: string
  description: string
}

/** 划选开分支的静态示意（纯展示，不接真实模型）。 */
export interface BranchingDemoContent {
  title: string
  description: string
  sampleAnswer: string // 样例 assistant 回复
  anchorText: string // 其中被"划选"高亮的片段（必须是 sampleAnswer 的子串）
  branchQuestion: string // 由该片段岔出的子问题
}

export interface CanvasShowcaseContent {
  title: string
  description: string
  media?: string // 可选静态示意资源路径（后续补）
}

/** 落地页全部内容的聚合——组件从这里取，改文案不改结构。 */
export interface LandingContent {
  hero: HeroContent
  branchingDemo: BranchingDemoContent
  canvasShowcase: CanvasShowcaseContent
  features: FeatureItem[]
  closingCta: CtaContent
}

export const LANDING: LandingContent // 占位文案，待细化；结构以上为准
```

### `components/landing/*` —— 分区组件 props

```ts
import type { ReactElement } from "react"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

export function Hero(props: SectionProps): ReactElement
export function BranchingDemo(props: SectionProps): ReactElement
export function CanvasShowcase(props: SectionProps): ReactElement
export function FeatureGrid(props: SectionProps): ReactElement
export function ClosingCta(props: SectionProps): ReactElement

/**
 * 共用 CTA 按钮——server component，next/link + Button(asChild)。
 * 不读会话、不生成 treeId（未登录的拦截交给旗舰门禁）。
 */
export interface StartChatButtonProps {
  label?: string // 默认 LANDING.hero.primaryCta.label
  href?: string // 默认 ROUTES.flagship
  size?: "default" | "lg"
  className?: string
}
export function StartChatButton(props: StartChatButtonProps): ReactElement
```

### `app/thread-chat/layout.tsx` —— 旗舰门禁签名

```ts
import type { ReactElement, ReactNode } from "react"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/server"
import { ROUTES, signInWithRedirect } from "@/constants/routes"

/** 服务端 layout——一处包住 /thread-chat 与 /thread-chat/[treeId]。 */
export default async function ThreadChatLayout({
  children,
}: {
  children: ReactNode
}): Promise<ReactElement> {
  const session = await getSession()
  if (!session) redirect(signInWithRedirect(ROUTES.flagship))
  return <>{children}</>
}
```

### `app/page.tsx` —— 落地页组合（重写）

```ts
import type { Metadata, ReactElement } from "next" // Metadata 自 next
export const metadata: Metadata // 落地页专属（替换线性聊天 metadata）

export default function LandingPage(): ReactElement
// <main> 内按序组合 Hero / BranchingDemo / CanvasShowcase / FeatureGrid / ClosingCta
// server component，不读 session（保持静态可缓存）
```

### `components/auth/auth-form.tsx` —— 落点改动（唯一逻辑改动点）

```ts
// before: const redirect = params.get("redirect") || "/"
// after:
import { DEFAULT_AUTHED_REDIRECT } from "@/constants/routes"
const redirect = params.get("redirect") || DEFAULT_AUTHED_REDIRECT
// 邮箱登录 router.push(redirect)、注册 callbackURL、Google callbackURL 三处共用此值，无需分别改
```

### 移除清单 → 依赖影响映射

| 删除项 | 唯一引用方（已 grep 确认） | 删后处理 |
|--------|----------------------------|----------|
| `components/examples/base*` | `app/page.tsx` | 随 page 重写移除 import |
| `components/assistant-ui/tools.tsx` + `weather/notepad/compare-table` 工具 | `app/page.tsx`（`AssistantTools`） | 一并删 |
| `lib/chat/thread-list-adapter.ts` | `app/page.tsx` | 删 |
| `lib/chat/use-thread-history-adapter.ts` | `app/page.tsx` | 删 |
| `app/api/threads/**` | 上述两个 adapter | 随 adapter 删（无其他调用方） |
| `threads` / `messages` 表（`lib/db/schema.ts`） | 上述 API/adapter | 删定义 + drop 迁移 |
| **保留** `/api/chat` | `app/thread-chat/net/*`（threadChat） | **不动** |
| **保留** `r2AttachmentAdapter` / `useResearchMode` / `useModelMode` | 旗舰亦用 | **不动** |

## Decisions

### D1：落地页保持 server + 静态（不读 session）

落地页是获客页，`/` 不读会话 → 保持静态可 CDN 缓存、首屏快。CTA 恒定指向 `/thread-chat`，登录态的差异化交给旗舰门禁。**弃选**：`/` 服务端读 session 切换 CTA 文案（"开始聊天" vs "继续对话"）——收益小却让整页转 dynamic、丢缓存，不值。

### D2：落地页从 proxy 白名单放行；旗舰叠服务端 layout 真校验（与 /account 同构）

两处配合：

1. **`/` 加入 `proxy.ts` 的 `publicPages`**——否则边缘乐观门禁把落地页当受保护页，登出访客访问 `/` 直接被弹 `/sign-in?redirect=%2F`（实测踩到过）。白名单项用 `ROUTES.landing` 绑单一事实来源。
2. **旗舰 `app/thread-chat/layout.tsx` 叠服务端 `getSession()` 真校验**——proxy 只查 cookie 存在性（"幽灵" cookie 能骗过边缘），layout 在页面加载再做真校验，与 `/account` 完全同构（受保护页 = proxy 乐观拦 + 页面 getSession）。一处 layout 同时 gate 跳板与 `[treeId]`。

**弃"仅靠 proxy"**：proxy 不查库，幽灵 cookie 会放行到旗舰、只剩 API 401 兜底、体验差；`/account` 已确立"双层"先例，旗舰照做。**redirect 目标用裸 `/thread-chat`**：server layout 拿不到 `[treeId]` 的具体 pathname（layout 无 pathname prop），而未登录者本就没有属于自己的树，跳裸路径登录后生成新树即可；为精确回跳去引 `x-pathname` header 不划算（见 Open Questions）。

### D3：路由与默认落点常量化

`ROUTES` / `DEFAULT_AUTHED_REDIRECT` / `signInWithRedirect` 集中在 `constants/routes.ts`，被 CTA、门禁、auth-form 三处共用——避免 `"/thread-chat"` 字面量散落（CLAUDE.md 的"扫魔法串/去重"纪律）。

### D4：落地页内容数据驱动

全部文案/结构进 `constants/landing.ts` 的 `LANDING`，组件只做布局。视觉/文案细化 = 改数据，不动组件结构 → 与"landing 具体设计待后续"解耦。

### D5：移除采用"删干净"含 drop 迁移

pre-launch 无生产数据，`threads`/`messages` 连表带 API 带 adapter 一次删净，不留死代码死表。**弃选**：留空表休眠（省一次破坏性迁移，但遗留死表/死代码，与"退役"目标相悖）。删表迁移经 `pnpm db:generate` 生成、评审后再 apply。

## Risks / Trade-offs

- **[删表迁移不可逆]** → pre-launch 无生产数据；迁移单独一条、评审确认；本地先 `pnpm db:migrate` 验证再上线。回滚 = revert 代码 + 迁移（可接受重建）。
- **[误删 `/api/chat` 或共享件]** → 已 grep 锁定 `Base`/`AssistantTools`/两个 adapter 仅 `app/page.tsx` 引用；`/api/chat`、attachment-adapter、research/model-mode 明列保留；apply 后 `pnpm typecheck` + `verify-live`（threadChat 模式）回归兜底。
- **[落地页静态但 CTA 目标要登录]** → 这是预期编排（门禁 gate + redirect 回跳），非 bug；e2e 覆盖登出→CTA→sign-in→回旗舰全链。
- **[门禁与 `fetchWithAuth` 401 双跳双写 redirect]** → 二者互补：layout 管首屏加载态、`fetchWithAuth` 管使用中会话失效；redirect 参数格式一致（`signInWithRedirect`），不冲突。

## Migration Plan

1. 新增 `constants/routes.ts` / `constants/landing.ts` / `components/landing/*` / `app/thread-chat/layout.tsx`；改 `app/page.tsx`、`auth-form.tsx`。
2. 删线性聊天栈（组件/adapter/API），`lib/db/schema.ts` 删 `threads`/`messages`。
3. `pnpm db:generate` 生成 drop 迁移 → 本地 `pnpm db:migrate` 验证。
4. `pnpm typecheck` / `pnpm lint` / `pnpm build` 全绿；`verify-live` 等旗舰 e2e 回归 PASS（守护 `/api/chat` 未受损）。
5. 上线执行 `pnpm db:migrate`。回滚 = revert 本变更提交 + 迁移。

## Open Questions

- **落地页视觉稿/文案**：`LANDING` 先填占位，结构已定；细化留独立跟进，不阻塞本变更。
- **精确 `[treeId]` 回跳**：当前门禁跳裸 `/thread-chat`。若产品要求"会话失效后 bookmark 精确恢复到原树"，再评估在 `[treeId]/page.tsx` 内做 param 级 gating 或引 `x-pathname` header——非本次范围。
