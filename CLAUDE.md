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

There is no test framework configured.

To add a shadcn/ui component: `npx shadcn@latest add <name>` (lands in `components/ui/`).

## Architecture

Next.js **16** App Router project (React 19, TypeScript, Tailwind CSS **v4**), scaffolded from a shadcn/ui template, intended to become a thread/chat agent UI.

- **Next.js 16 is newer than your training data.** Per AGENTS.md, APIs and conventions may have breaking changes — consult the bundled docs at `node_modules/next/dist/docs/` before writing Next-specific code, and heed deprecation notices.
- **shadcn/ui on Base UI, not Radix.** `components.json` uses the `base-rhea` style; primitives in `components/ui/` import from `@base-ui/react` (e.g. `@base-ui/react/button`). Don't reach for `@radix-ui/*` when editing or adding components.
- **The full component kit is already vendored** in `components/ui/` (~60 components), including chat-oriented primitives: `message.tsx`, `message-scroller.tsx`, `bubble.tsx`, `attachment.tsx`, `marker.tsx`. Check for an existing component before adding or writing a new one.
- **Tailwind v4, CSS-first config.** There is no tailwind.config file; theme tokens live as CSS variables in `app/globals.css`. Class merging goes through `cn()` in `lib/utils.ts`.
- Path aliases: `@/components`, `@/components/ui`, `@/lib`, `@/hooks` (see `components.json` and tsconfig.json).
- Theming via `next-themes` through `components/theme-provider.tsx`, wired up in `app/layout.tsx` (dark mode toggles with the `d` key on the starter page).
