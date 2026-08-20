---
name: thread-chat-coolify-deploy
description: Deploy and operate this thread-chat repository's development and production applications on the Singapore Coolify VPS, including initial resource setup, selective environment-variable updates, sequential releases, and post-deploy verification. Use only for this repository's Coolify layout.
---

# Thread Chat Coolify Deploy

This is a project-specific overlay on `coolify-ops`. Read and follow the full `coolify-ops` skill before any Coolify action. For browser acceptance testing, read and use the `ego-browser` skill; repository instructions forbid substituting another browser or web tool.

## Start by choosing the operation

Keep the user's requested scope exact:

- **Initial setup**: create or reconcile both databases and applications, configure environment variables, then deploy development before production.
- **Redeploy**: deploy the already configured application from its bound remote branch and watch it to a terminal state.
- **Targeted environment update**: update only the named keys. Do not use bulk sync, touch the other environment, or change build/runtime metadata.
- **Troubleshoot or verify**: inspect state and logs without changing configuration unless the user also asks for a fix.

Read [references/deployment-contract.md](references/deployment-contract.md) for the project-specific resource names, build contract, environment inventory, and acceptance checks. Treat live Coolify state and current repository code as authoritative when they differ from historical setup details.

## Safety and secret handling

- Use the official `coolify` CLI through the configured context. Do not use the Coolify web UI or raw API as a silent fallback.
- Re-resolve resource UUIDs from list commands before every target operation. Never reuse a UUID from memory or this skill.
- Run the exact subcommand's `--help` before mutating state; CLI flags and API fields have changed across versions.
- Pipe list output directly through `jq` and project only non-sensitive fields. In particular, never print raw `coolify app list --format=json`: some server versions include manual webhook secrets in that payload even without `--show-sensitive`.
- Never print, log, diff, commit, or write back secret values. When verification requires sensitive reads, capture them without displaying them and compare equality or hashes only.
- Parse dotenv files as data. Do not `source` them: values may contain shell syntax, and sourcing broadens the action beyond reading named keys.
- Never sync all of `.env.local`. It is a local-development file and may contain unrelated credentials. A production update from it is allowed only for keys the user explicitly names.
- Never write Coolify's internal database URLs back to repository env files.
- Follow `coolify-ops` confirmation rules for destructive or production-impacting actions. A normal restart after an authorized runtime-variable update is part of the requested change; deletion, stop, rollback, forced deploy, database exposure, and branch changes require their own scope and confirmations.

## Resolve and inspect live state

1. Verify the `singapore-vps` context and inspect CLI version.
2. Resolve apps, databases, project, and server using JSON plus `jq`. Emit only fields needed for the task, such as name, UUID, status, FQDN, repository, and branch.
3. Ensure the matched app name is exact: `thread-chat-dev` for development or `thread-chat` for production. Abort on zero or multiple matches.
4. Inspect the target variables or deployment configuration before changing them.
5. If the CLI reports an API validation mismatch such as `is_build_time` versus `is_buildtime`, upgrade to a compatible official CLI and re-read help. Do not retain a temporary patched binary as the deployment mechanism.

## Environment-variable operations

For a targeted update:

1. Confirm every requested key exists and is non-empty in the named source file without printing values.
2. Resolve the target app again and list only those remote variables' keys, UUIDs, and build/runtime flags.
3. Update each key individually. When only its value is changing, omit build/runtime flags so existing metadata is preserved.
4. Read back the named values with sensitive output captured, compare them to the source without printing either side, and re-check that their metadata did not change.
5. Restart the target app when all changed variables are runtime-only. Redeploy only when build-time inputs or source/configuration changed.
6. Poll until `running:healthy`; tolerate the transient `running:unhealthy` state during restart. In zsh polling snippets, use a variable such as `app_state`, not the reserved parameter `status`.

For initial or bulk configuration, build an explicit allowlist from the deployment contract and current code. Never pass `.env.production` or `.env.local` wholesale to `env sync`. Keep provider secrets runtime-only unless current code demonstrably needs a public or build-time value.

## Release workflow

1. Inspect the working tree, current branch, remote branch, and commit. A Coolify deployment uses the bound remote source; do not push, commit, or silently switch branches unless the user asked for that action.
2. Run `pnpm typecheck` and `pnpm build` for code/configuration changes. A value-only runtime update does not require a local rebuild.
3. On initial setup, create and start isolated pgvector databases before applications, then configure the applications without triggering simultaneous builds.
4. Deploy development first and follow deployment logs to success. If development fails, do not start production.
5. Validate development at the level authorized by the user.
6. Deploy production only after development is healthy. The VPS has limited memory; never build both applications concurrently.
7. Follow production logs and poll health to a terminal result. Do not report success merely because the deploy request was queued.

Allow at most one automatic retry after identifying and correcting a concrete in-scope cause. Do not loop deployments or restarts without a diagnosis.

## Verification and handoff

At minimum, verify Coolify reports the target app as `running:healthy` and inspect relevant startup/deployment errors. When the request includes end-to-end acceptance and DNS is ready, use `ego-browser` to verify the HTTPS domain and the requested user flows. Do not make billable model calls, create accounts, upload files, or mutate production data unless that level of testing is within the user's request.

Report:

- which environment and resource changed;
- which key names or configuration fields changed, never their values;
- whether a restart or full deployment occurred;
- final app/deployment health;
- any explicitly deferred manual work, such as Cloudflare DNS, Google OAuth callback configuration, R2 CORS, backups, or webhook automation.
