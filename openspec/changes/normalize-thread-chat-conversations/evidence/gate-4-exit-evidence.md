# Gate 4 Exit Evidence

Date: 2026-08-27

## Cutover result

- `drizzle/0005_legacy_thread_chat_backup.sql` only renames the three legacy
  tables to `legacy_branch_trees_backup`,
  `legacy_branch_generations_backup`, and
  `legacy_branch_message_feedback_backup`.
- The application schema no longer exports the legacy tables. The migration
  contains no `DROP`, compatibility view, data copy, or dual-write DML.
- The production `/thread-chat/[treeId]` route now boots the normalized v1
  Project/Thread/Message store and uses only `/api/thread-chat/v1` commands,
  SSE, and polling.
- The old branch-tree routes, generation reconciliation/runtime, whole-tree
  persistence, active-leaf/variant contracts, and `/api/chat` ThreadChat mode
  were retired. Linear `/api/chat` remains independent and keeps its existing
  billing behavior; normalized ThreadChat has no billing imports or calls.
- No CSS file changed. The variant picker remains removed as previously
  approved; no other intended UX/UI change was introduced.

## PostgreSQL evidence

The dedicated `thread-chat-normalized-test` PostgreSQL database passed:

- `pnpm test:thread-chat:gate1-db`
- `pnpm test:thread-chat:gate2-db`
- `pnpm test:thread-chat:gate2-api-db`
- `pnpm test:thread-chat:gate4-cutover`

The Gate 4 rehearsal started with seeded rows in all three old tables and empty
normalized conversation tables. After applying migration 0005 it verified:

- old table names were absent and all legacy row counts were preserved in the
  backup tables;
- an old Project URL returned an empty normalized workspace instead of falling
  back to legacy history;
- the first send on that URL wrote only `projects`, `threads`, and `messages`;
- legacy backup row counts stayed unchanged;
- a zero-credit user could generate through the controlled fake runtime while
  `user_credits` and `usage_records` stayed unchanged.

The Mac development database has a pre-existing Drizzle migration-ledger drift
(23 unrelated historical ledger rows), so `pnpm db:migrate` exits before
migration 0005 is considered. Running the exact three rename statements inside
`BEGIN`/`ROLLBACK` succeeded. The local ledger was deliberately not rewritten;
the production cutover must follow the runbook against a backed-up database.

## Formal-route browser evidence

Using `ego-browser nodejs` against
`/thread-chat/9f5fe510-3498-4a37-8bf0-21c38b0115b1` with an isolated local test
session verified:

- the existing topbar, column controls, canvas switch, placement controls,
  tree switcher, Markdown drawer, help content, Composer, and model selector
  rendered without a test harness or variant control;
- the first send invoked
  `/api/thread-chat/v1/projects/:projectId/start` and
  `/api/thread-chat/v1/messages/:messageId/stream`, and a real model response
  completed;
- refresh restored the user and assistant messages from PostgreSQL using only
  the v1 Project bootstrap endpoint;
- Retry invoked `/api/thread-chat/v1/messages/:messageId/retry`, streamed a new
  assistant Message, left the original Message `completed`, set only its
  `superseded_at`, and linked the new Message through `replaces_message_id`;
- no old branch API, `/api/chat`, billing endpoint, alert, or Next.js error
  overlay appeared.

The temporary browser task space and its local test user/session/project were
removed after verification.

## Static, Node, and build evidence

Passed:

- all remaining non-DB `e2e/thread-chat/*.test.mjs` tests;
- `node scripts/check-thread-chat-cutover.mjs`;
- `node scripts/check-thread-chat-v1-boundaries.mjs`;
- `pnpm typecheck`;
- `pnpm lint` with zero errors and two pre-existing unrelated warnings in
  `app/layout.tsx` and `lib/auth/session-recovery.ts`;
- `pnpm openspec:validate` with 26 passed and 0 failed;
- `git diff --check` and an empty CSS diff.

`pnpm build` reached Turbopack but the agent execution environment denied an
internal PostCSS worker from binding a port (`Operation not permitted`). The
installed Next.js 16.3.1 documentation explicitly supports `next build
--webpack`; `pnpm exec next build --webpack` then completed the optimized
production build, TypeScript check, static generation, and route collection.
The build route manifest contains the normalized v1 API and no retired branch
routes. Gate 5 must still run the normal build in the VPS/Coolify environment.

## Exit review

Gate 4 exits with normalized Project/Thread/Message/Artifact rows as the sole
ThreadChat authority, legacy tables as operations-only backups, no old-data
migration or fallback, no ThreadChat billing dependency, and an executable
backup/cutover/rollback runbook. Deployment and VPS failure drills remain Gate
5 work.
