# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言

所有输出内容必须使用中文（代码、文件路径、命令等技术内容除外）。

## Commands

Package manager is **pnpm** (pnpm-lock.yaml / pnpm-workspace.yaml).

- `pnpm dev` — start the Next.js dev server
- `pnpm build` — production build
- `pnpm lint` — ESLint (flat config, eslint.config.mjs)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm format` — Prettier (with prettier-plugin-tailwindcss for class sorting)
- `pnpm db:generate` — generate a Drizzle migration from `lib/db/schema.ts`
- `pnpm db:migrate` — apply pending migrations to `DATABASE_URL`
- `pnpm db:push` — push schema directly without a migration file (quick local iteration)
- `pnpm db:studio` — Drizzle Studio
- `pnpm openspec:validate` — validate OpenSpec changes/specs (`@fission-ai/openspec`, pinned as a devDependency so CI works without a global install; see `.github/workflows/openspec.yml`)

There is no test framework configured.

To add a shadcn/ui component: `npx shadcn@latest add <name>` (lands in `components/ui/`).

## Development workflow

- **Don't run `pnpm format` while writing code.** Only check logic correctness during development; formatting happens once, right before committing. (No husky/lint-staged is configured yet, so this is a manual discipline, not an enforced hook — set one up if asked.)
- **Run `pnpm typecheck` after each batch of code changes** (a file, or a set of related edits) and fix any errors immediately rather than letting them accumulate.
- **凡是 `import`（含 `import type`）某个包的子路径，该包必须是 `package.json` 里的直接依赖 —— 不要依赖幻影依赖（phantom dependency）。** pnpm 有时会把传递依赖 hoist 到 `node_modules/` 根,使得本地 `pnpm typecheck`/`pnpm build` 侥幸通过,但 Vercel 干净安装 + pnpm 严格解析下不可从项目根解析,构建报 `Cannot find module 'X'`。**本地构建过 ≠ Vercel 构建过。** 判据:import 的包名若不在 `package.json` 的 `dependencies`/`devDependencies` 里,就显式声明它(版本对齐同族包)。运行时才需要的进 `dependencies`,纯类型(`import type`,构建时擦除)进 `devDependencies`。已被 shiki 家族咬过两次:`@shikijs/langs`·`@shikijs/themes`·`@shikijs/transformers`(运行时,`dependencies`)、`@shikijs/types`(类型,`devDependencies`)—— 这个包族把 langs/themes/types 拆成一堆子包,直接 import 任一子路径都得声明。
- **After finishing a module-sized chunk of work, sweep for magic strings and duplicated variables/strings/functions.**
  - Constants go in the **`constants/` directory**, split into topic files (e.g. `constants/model.ts`), each with a short comment explaining its purpose — not inlined, not redefined per-file.
  - Shared utility functions get grouped into the matching subdirectory under `lib/` (e.g. `lib/chat/`, `lib/db/`) by domain, not left scattered across files or dumped into `lib/utils.ts`.

## Architecture

Next.js **16** App Router project (React 19, TypeScript, Tailwind CSS **v4**), scaffolded from a shadcn/ui template, intended to become a thread/chat agent UI.

- **Next.js 16 is newer than your training data.** Per AGENTS.md, APIs and conventions may have breaking changes — consult the bundled docs at `node_modules/next/dist/docs/` before writing Next-specific code, and heed deprecation notices.
- **shadcn/ui on Base UI, not Radix.** `components.json` uses the `base-rhea` style; primitives in `components/ui/` import from `@base-ui/react` (e.g. `@base-ui/react/button`). Don't reach for `@radix-ui/*` when editing or adding components.
- **The full component kit is already vendored** in `components/ui/` (~60 components), including chat-oriented primitives: `message.tsx`, `message-scroller.tsx`, `bubble.tsx`, `attachment.tsx`, `marker.tsx`. Check for an existing component before adding or writing a new one.
- **Tailwind v4, CSS-first config.** There is no tailwind.config file; theme tokens live as CSS variables in `app/globals.css`. Class merging goes through `cn()` in `lib/utils.ts`.
- **thread-chat 的手写样式** 是独立于 Tailwind 的一层：全部收敛在 `.tc` 作用域（手工命名空间的手稿风设计系统，语义类名、非原子类）。共享规则按功能区块拆在 `app/thread-chat/styles/*.css`，`app/thread-chat/thread-chat.css` 只是按**源码顺序** `@import` 它们的桶文件；canonical 页面自己的布局扩展位于 `app/thread-chat/canonical/canonical-thread-chat.css`。设计 token（`--paper/--ink/--d1..d5/字体/尺寸`）的单一来源是 `styles/tokens.css`。
- Path aliases: `@/components`, `@/components/ui`, `@/lib`, `@/hooks` (see `components.json` and tsconfig.json).
- Theming via `next-themes` through `components/theme-provider.tsx`, wired up in `app/layout.tsx` (dark mode toggles with the `d` key on the starter page).

## assistant-ui

This project uses assistant-ui for chat interfaces.

Documentation: https://www.assistant-ui.com/llms-full.txt (thin/incomplete on tool-UI and version-compat details — when in doubt, read the real signatures in `node_modules/@assistant-ui/*/dist/*.d.ts` or the shipped `.ts` sources under `node_modules/@assistant-ui/core/src/`, which are more reliable than the docs for this fast-moving pre-1.0 package).

Key patterns:

- Use AssistantRuntimeProvider at the app root
- Thread component for full chat interface
- AssistantModal for floating chat widget
- `useChatRuntime` hook with AI SDK transport — in this repo it's composed with `useRemoteThreadListRuntime` for Postgres persistence, see "Database & thread persistence" below.

## AI backend

`app/api/chat/route.ts` 只服务首页 assistant-ui 的线性聊天；它通过统一模型注册表选择 MiniMax、Ark、OpenRouter 等 provider。AI SDK is at **v7** (`ai@^7`); note `ai` and `@ai-sdk/react` (`@^4`) track independent version numbers in this ecosystem, they are not in lockstep. Env vars live in `.env.local`，实际键名由 provider 注册表决定。

MiniMax emits chain-of-thought as literal `<think>...</think>` text rather than a dedicated reasoning stream part. The model is wrapped with `wrapLanguageModel` + `extractReasoningMiddleware({ tagName: "think" })` so it renders as a collapsible reasoning block instead of raw text in the message.

Three tools are wired end-to-end as a reference for adding more:

- `getWeather` and `compareTable` — **backend** tools (mock data; `compareTable` uses `display: "standalone"` for its generative-UI table), defined server-side only in `route.ts`.
- `writeNote` — a **frontend** tool that actually executes in the browser (saves to `localStorage`), defined client-side and forwarded to the model via `@assistant-ui/react-ai-sdk`'s `frontendTools()`.

Each tool's custom UI is registered with the `useAssistantTool({ toolName, type, render, ... })` hook from `@assistant-ui/react`, in `components/assistant-ui/{weather,notepad,compare-table}-tool.tsx`. These are null-returning components mounted via `<AssistantTools />` (`components/assistant-ui/tools.tsx`) inside `AssistantRuntimeProvider` in `app/page.tsx`. `useAssistantTool` is marked `@deprecated` in favor of `defineToolkit`/`Tools({ toolkit })` + `useAui({ tools })`, but that path assumes assistant-ui's "use generative" compiler, which isn't set up in this project — keep using `useAssistantTool` for new tools unless that changes.

`/thread-chat` 不使用 `/api/chat`。它通过 `app/api/conversation-commands/*`、`app/api/conversation-generations/*` 和 `app/api/conversations/*` 操作 canonical `Project → Conversation → Thread → Turn/Message/Generation` 实体；服务端从规范 snapshot 编译模型上下文，客户端只保存可丢弃的列/画布 UI 状态。向 `/api/chat` 发送旧 `threadChat` envelope 会返回 `410 legacy_protocol_retired`。

## Database & thread persistence

Drizzle ORM + Postgres backs chat history so threads survive page reloads (previously in-memory only, lost on refresh).

- Local dev DB: Docker container `fullstack-starter-postgres` (shared across several unrelated side-projects on this machine — never touch its other databases), dedicated database **`thread-chat`**, connected via `DATABASE_URL` in `.env.local`.
  - **Gotcha**: a native Homebrew `postgresql@17` service can also bind port 5432 and silently shadow the Docker container's port mapping for host connections (the host process wins over the container's `0.0.0.0:5432` mapping). If `DATABASE_URL` can't connect, check `brew services list | grep postgres` and `lsof -iTCP:5432 -sTCP:LISTEN` for a conflicting native instance before assuming the container itself is broken.
- Schema: `lib/db/schema.ts` — `threads` and `messages` tables. `messages.content` stores the full AI SDK `UIMessage` (minus `id`) as JSONB rather than normalizing individual parts, so tool-call/tool-result parts (or new tools) need no schema changes.
- Client: `lib/db/index.ts` — a global-singleton `postgres`/drizzle client so dev HMR doesn't exhaust Postgres connections.
- Migrations: `drizzle.config.ts` + `drizzle/` (see `pnpm db:*` scripts above).
- Persistence wiring: `lib/chat/thread-list-adapter.ts` implements assistant-ui's `RemoteThreadListAdapter` (list/rename/archive/delete/initialize/fetch/generateTitle) against `app/api/threads/*` route handlers. `lib/chat/use-thread-history-adapter.ts` implements `ThreadHistoryAdapter.withFormat()` for per-thread message load/append. Both are composed in `app/page.tsx` via `useRemoteThreadListRuntime({ runtimeHook: () => useChatRuntime({ adapters: { history } }), adapter })` — `useChatRuntime`'s own internal remote-thread-list wrapper detects it's nested (`allowNesting: true`) and no-ops, so this composition doesn't conflict with it.
- **Canonical Conversation persistence** (`app/thread-chat/`): URL 中的 ID 是 `Conversation.id`，不是 Tree ID。`lib/db/schema.ts` 中的 `conversations`、`conversation_threads`、`thread_forks`、`conversation_turns`、`conversation_messages`、`conversation_generations`、Artifact、command/outbox 与反馈表是唯一事实源；关系由 FK、唯一约束和 revision/idempotency CAS 保护。客户端 normalized store 只投影服务端 snapshot，localStorage 仅保存按 Conversation 分隔且可丢弃的 UI workspace。裸 `/thread-chat` 通过认证后的 canonical bootstrap 找到或建立个人 Project/Conversation。旧 `branch_trees`、`branch_generations` 与 `branch_message_feedback` 已由迁移删除；历史 migration 和已验证备份不改写。变更 schema 使用 `pnpm db:generate` 后运行 `pnpm db:migrate`，不得把交互式 `db:push` 当作发布迁移。
