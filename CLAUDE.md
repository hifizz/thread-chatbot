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
- **After finishing a module-sized chunk of work, sweep for magic strings and duplicated variables/strings/functions.**
  - Constants go in the **`constants/` directory**, split into topic files (e.g. `constants/model.ts`), each with a short comment explaining its purpose — not inlined, not redefined per-file.
  - Shared utility functions get grouped into the matching subdirectory under `lib/` (e.g. `lib/chat/`, `lib/db/`) by domain, not left scattered across files or dumped into `lib/utils.ts`.

## Architecture

Next.js **16** App Router project (React 19, TypeScript, Tailwind CSS **v4**), scaffolded from a shadcn/ui template, intended to become a thread/chat agent UI.

- **Next.js 16 is newer than your training data.** Per AGENTS.md, APIs and conventions may have breaking changes — consult the bundled docs at `node_modules/next/dist/docs/` before writing Next-specific code, and heed deprecation notices.
- **shadcn/ui on Base UI, not Radix.** `components.json` uses the `base-rhea` style; primitives in `components/ui/` import from `@base-ui/react` (e.g. `@base-ui/react/button`). Don't reach for `@radix-ui/*` when editing or adding components.
- **The full component kit is already vendored** in `components/ui/` (~60 components), including chat-oriented primitives: `message.tsx`, `message-scroller.tsx`, `bubble.tsx`, `attachment.tsx`, `marker.tsx`. Check for an existing component before adding or writing a new one.
- **Tailwind v4, CSS-first config.** There is no tailwind.config file; theme tokens live as CSS variables in `app/globals.css`. Class merging goes through `cn()` in `lib/utils.ts`.
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

`app/api/chat/route.ts` streams from **MiniMax** via `@ai-sdk/openai-compatible` — not real OpenAI. AI SDK is at **v7** (`ai@^7`); note `ai` and `@ai-sdk/react` (`@^4`) track independent version numbers in this ecosystem, they are not in lockstep. Env vars live in `.env.local`: `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `LLM_MODEL_ID`.

MiniMax emits chain-of-thought as literal `<think>...</think>` text rather than a dedicated reasoning stream part. The model is wrapped with `wrapLanguageModel` + `extractReasoningMiddleware({ tagName: "think" })` so it renders as a collapsible reasoning block instead of raw text in the message.

Three tools are wired end-to-end as a reference for adding more:
- `getWeather` and `compareTable` — **backend** tools (mock data; `compareTable` uses `display: "standalone"` for its generative-UI table), defined server-side only in `route.ts`.
- `writeNote` — a **frontend** tool that actually executes in the browser (saves to `localStorage`), defined client-side and forwarded to the model via `@assistant-ui/react-ai-sdk`'s `frontendTools()`.

Each tool's custom UI is registered with the `useAssistantTool({ toolName, type, render, ... })` hook from `@assistant-ui/react`, in `components/assistant-ui/{weather,notepad,compare-table}-tool.tsx`. These are null-returning components mounted via `<AssistantTools />` (`components/assistant-ui/tools.tsx`) inside `AssistantRuntimeProvider` in `app/page.tsx`. `useAssistantTool` is marked `@deprecated` in favor of `defineToolkit`/`Tools({ toolkit })` + `useAui({ tools })`, but that path assumes assistant-ui's "use generative" compiler, which isn't set up in this project — keep using `useAssistantTool` for new tools unless that changes.

`/api/chat` also has a **threadChat mode** for the branch-chat page (`app/thread-chat/`): the client sends `threadChat: { anchorText }` in the body (AI SDK v7's `streamText` rejects system-role messages from the client, so system prompts are server-owned), and the route builds a plain-text system prompt via `buildThreadChatSystem()` (`lib/chat/thread-chat-prompt.ts`, templates in `constants/thread-chat.ts`). In this mode the backend tools (`getWeather`/`compareTable`) are **not** attached. Additionally, `toUIMessageStreamResponse({ onError })` logs in-stream errors server-side (`[chat] 流内错误:`) for all modes while still masking them to the client.

## Database & thread persistence

Drizzle ORM + Postgres backs chat history so threads survive page reloads (previously in-memory only, lost on refresh).

- Local dev DB: Docker container `fullstack-starter-postgres` (shared across several unrelated side-projects on this machine — never touch its other databases), dedicated database **`thread-chat`**, connected via `DATABASE_URL` in `.env.local`.
  - **Gotcha**: a native Homebrew `postgresql@17` service can also bind port 5432 and silently shadow the Docker container's port mapping for host connections (the host process wins over the container's `0.0.0.0:5432` mapping). If `DATABASE_URL` can't connect, check `brew services list | grep postgres` and `lsof -iTCP:5432 -sTCP:LISTEN` for a conflicting native instance before assuming the container itself is broken.
- Schema: `lib/db/schema.ts` — `threads` and `messages` tables. `messages.content` stores the full AI SDK `UIMessage` (minus `id`) as JSONB rather than normalizing individual parts, so tool-call/tool-result parts (or new tools) need no schema changes.
- Client: `lib/db/index.ts` — a global-singleton `postgres`/drizzle client so dev HMR doesn't exhaust Postgres connections.
- Migrations: `drizzle.config.ts` + `drizzle/` (see `pnpm db:*` scripts above).
- Persistence wiring: `lib/chat/thread-list-adapter.ts` implements assistant-ui's `RemoteThreadListAdapter` (list/rename/archive/delete/initialize/fetch/generateTitle) against `app/api/threads/*` route handlers. `lib/chat/use-thread-history-adapter.ts` implements `ThreadHistoryAdapter.withFormat()` for per-thread message load/append. Both are composed in `app/page.tsx` via `useRemoteThreadListRuntime({ runtimeHook: () => useChatRuntime({ adapters: { history } }), adapter })` — `useChatRuntime`'s own internal remote-thread-list wrapper detects it's nested (`allowNesting: true`) and no-ops, so this composition doesn't conflict with it.
- Branch-tree persistence (`app/thread-chat/`): the `branch_trees` table stores each branch-conversation tree as **one row of whole-tree JSON** (`state` = full `ThreadTreeState`) — completely separate from the assistant-ui `threads`/`messages` tables (linear chat vs tree state; no FKs, no row reuse). Tree identity lives in the URL (`/thread-chat/{treeId}`, client-generated UUID); localStorage only remembers the "last opened" treeId (bare-path redirect target) plus per-tree workbench UI state (`thread-chat:ui:{treeId}`). Client wiring (load → sanitize → debounced whole-tree PUT) is in `app/thread-chat/net/persist.ts` + `app/api/branch-trees/[treeId]/route.ts`. Titles are **dual-track**: the debounced PUT only writes the derived `title` column, while user renames (PATCH, tree-list popup ⌘⇧K) only write the nullable `custom_title` column — display is always `coalesce(custom_title, title)`, so a rename is never clobbered by continued chatting. The lightweight list API (`GET /api/branch-trees` — id/display title/updatedAt/SQL-derived threadCount, never the full `state`) plus PATCH/DELETE back the tree-list popup (`app/thread-chat/orchestration/tree-list.tsx`).