# Thread Chat Coolify Deployment Contract

Use this reference for initial setup, reconciliation, bulk environment configuration, or full acceptance testing. For a narrow restart, redeploy, or targeted environment update, load only the relevant section.

## Stable resource identities

| Environment | Coolify app | Database | Domain | R2 bucket |
|---|---|---|---|---|
| development | `thread-chat-dev` | `thread-chat-dev-db` | `https://threadchat-dev.zilin.im` | `thread-chat-dev` |
| production | `thread-chat` | `thread-chat-prod-db` | `https://threadchat.zilin.im` | `thread-chat-prod` |

- Coolify context: `singapore-vps`
- Coolify project: `next-generation-chatbot`
- Repository: `https://github.com/hifizz/thread-chatbot.git`
- Source type: public Git repository; no GitHub webhook was configured in the initial deployment.
- The initial deployment tracked `codex/tavily-proactive-research-demo` and began at commit `e6c7c08`. This is historical context, not a permanent branch policy. Preserve each live app's currently bound branch unless the user explicitly requests a change.
- Cloudflare DNS is user-managed. Do not mutate Cloudflare records as part of ordinary Coolify deployment.

Always resolve current UUIDs and settings from Coolify; do not store them here.

## Build and runtime contract

| Setting | Value |
|---|---|
| Build pack | Nixpacks |
| Node | `NIXPACKS_NODE_VERSION=24` |
| Exposed port | `3000` |
| Install | `pnpm install --frozen-lockfile` |
| Build | `pnpm build` |
| Start | `pnpm db:migrate && pnpm start` |
| Health check | `GET /`, expected 200 |
| Database image | `pgvector/pgvector:pg16` |
| Database access | Coolify internal network only |

The initial app limits were 1.5 CPU and 2 GB memory per app on a 4 GB VPS. Reconcile rather than blindly overwrite live limits. Build development and production sequentially to avoid OOM pressure.

Databases are isolated and start empty. Do not import local or former Vercel data unless the user separately requests a migration. The application start command applies committed Drizzle migrations.

## Environment sources and boundaries

- `.env.example`: inventory and documentation. It may contain optional or newly added variables; its presence alone does not authorize production sync.
- `.env.production`: source for shared production-ready provider credentials. It is gitignored. Sync only an explicit allowlist.
- `.env.local`: local development source. Read from it for a remote environment only when the user explicitly names the target keys and environment.
- Coolify-generated database URLs: source for `DATABASE_URL` and `DIRECT_URL`; keep them inside Coolify.

The initial shared allowlist was:

- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `LLM_MODEL_ID`
- `ARK_CODING_API_KEY`
- `OPENROUTER_API_KEY`
- `UMAPIS_BASE_URL`, `UMAPIS_API_KEY_CLAUDE`, `UMAPIS_API_KEY_GPT`
- `ANYSEARCH_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

This list records the deployed baseline, not a universal truth. Before a new initial deployment, reconcile it with current code and `.env.example`. Add or remove keys only when current code and the user's requested capabilities justify it. Do not revive historical variables solely because they remain in an old env file.

Environment-specific overrides:

| Key | development | production |
|---|---|---|
| `DATABASE_URL` | dev Coolify Postgres internal URL | prod Coolify Postgres internal URL |
| `DIRECT_URL` | same dev direct internal URL | same prod direct internal URL |
| `BETTER_AUTH_URL` | `https://threadchat-dev.zilin.im` | `https://threadchat.zilin.im` |
| `BETTER_AUTH_SECRET` | independently generated secret | independently generated production secret |
| `R2_BUCKET` | `thread-chat-dev` | `thread-chat-prod` |
| `DB_POOL_MAX` | `10` | `10` |
| `DB_PREPARE` | `true` | `true` |
| `NIXPACKS_NODE_VERSION` | `24` | `24` |

Secrets and provider credentials are runtime-only. A public `NEXT_PUBLIC_*` variable is a separate case: it is intentionally browser-visible and may need build-time availability, so confirm its use in current code before setting flags.

## Initial deployment order

1. Confirm the target branch/commit exists on the remote repository.
2. Run local typecheck and production build.
3. Resolve Coolify placement UUIDs.
4. Create and start both isolated pgvector databases.
5. Create/configure both applications without concurrent builds.
6. Apply the explicit shared allowlist as runtime-only values.
7. Apply database, auth, bucket, pool, and Node overrides per environment.
8. Deploy and validate development.
9. Deploy and validate production.
10. Record deferred external configuration; do not claim those integrations work until tested.

## Acceptance matrix

Choose tests proportional to the request:

- Infrastructure: app health, TLS, startup and deployment logs.
- Isolation: dev and prod database URLs/resources differ; R2 buckets differ.
- Authentication: registration/login and Google OAuth after the callback URL is configured.
- Chat: configured model path, streaming response, refresh persistence.
- Search/providers: only providers whose variables are configured and whose calls the user authorizes.
- Attachments: presigned R2 upload and browser CORS behavior in both environments.

Cloudflare DNS, Google OAuth callbacks, and R2 CORS are external dependencies. An app reporting healthy does not prove them. Validate browser behavior with `ego-browser` after the user finishes those settings.

The initial release explicitly deferred automated database backups, webhook-based auto-deploy, Turnstile, and email verification. Treat each as unresolved unless live state or the user confirms it has since been configured.
