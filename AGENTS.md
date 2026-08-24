<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project instructions

Before working in this repository, read `CLAUDE.md` in full and follow its
project-wide instructions. `CLAUDE.md` is the single source of truth for shared
development commands, workflow rules, architecture, and implementation notes.

If an instruction in this file conflicts with `CLAUDE.md`, follow this file.

## Formatting

- **禁止 Agent 执行 `pnpm format`，也禁止主动执行其他 Prettier 格式化命令。** 仓库的 pre-commit hook 已负责格式化；如果该环节没有执行 format，不补跑、不排查，也不做任何手动格式化。
