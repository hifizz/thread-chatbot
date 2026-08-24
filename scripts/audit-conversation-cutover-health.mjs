import { spawnSync } from "node:child_process"

import { config } from "dotenv"
import postgres from "postgres"

config({ path: ".env.local", quiet: true })

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2")
const parsedUrl = new URL(databaseUrl)
const sql = postgres(databaseUrl, { max: 1, prepare: false })

function legacyRuntimeReferenceCount() {
  const result = spawnSync(
    "rg",
    [
      "-l",
      "branchTrees|branchGenerations|branchMessageFeedback|ThreadTreeState|thread-chat-generation",
      "app",
      "lib",
      "constants",
      "--glob",
      "!**/*.test.*",
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  )
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`rg 退出码 ${result.status}: ${result.stderr}`)
  return result.stdout.split("\n").filter(Boolean).length
}

async function legacyTableState() {
  const tableNames = [
    "branch_trees",
    "branch_generations",
    "branch_message_feedback",
    "legacy_conversation_entity_mappings",
  ]
  const rows = {}
  for (const table of tableNames) {
    const [relation] = await sql`
      SELECT to_regclass(${`thread_chat.${table}`})::text AS name`
    if (!relation?.name) {
      rows[table] = { present: false, count: 0 }
      continue
    }
    const [count] = await sql.unsafe(
      `SELECT count(*)::int AS value FROM thread_chat."${table}"`
    )
    rows[table] = { present: true, count: count.value }
  }
  return rows
}

try {
  const generationStatus = await sql`
    SELECT status, billing_status, usage_completeness,
      count(*)::int AS count,
      max(EXTRACT(EPOCH FROM (now() - heartbeat_at)))::int AS max_heartbeat_age_seconds
    FROM thread_chat.conversation_generations
    GROUP BY status, billing_status, usage_completeness
    ORDER BY status, billing_status, usage_completeness`
  const [generationRisks] = await sql`
    SELECT
      count(*) FILTER (WHERE status IN ('running', 'stop_requested'))::int AS active,
      count(*) FILTER (WHERE billing_status = 'pending')::int AS pending_billing,
      count(*) FILTER (WHERE status IN ('completed', 'stopped') AND checkpoint_version = 0)::int AS terminal_without_checkpoint,
      count(*) FILTER (WHERE status = 'completed' AND content_state <> 'complete')::int AS completed_with_incomplete_content,
      count(*) FILTER (WHERE status = 'stopped' AND content_state NOT IN ('incomplete', 'failed'))::int AS stopped_with_invalid_content_state,
      count(*) FILTER (WHERE status IN ('completed', 'stopped', 'failed', 'superseded') AND finished_at IS NULL)::int AS terminal_without_finished_at
    FROM thread_chat.conversation_generations`
  const outbox = await sql`
    SELECT status, count(*)::int AS count,
      max(EXTRACT(EPOCH FROM (now() - created_at)))::int AS max_age_seconds
    FROM thread_chat.conversation_outbox_events
    GROUP BY status ORDER BY status`
  const commands = await sql`
    SELECT command_type, count(*)::int AS count
    FROM thread_chat.conversation_command_records
    GROUP BY command_type ORDER BY command_type`
  const [usage] = await sql`
    SELECT
      count(*) FILTER (WHERE g.id IS NOT NULL)::int AS canonical_usage_records,
      count(*) FILTER (WHERE g.id IS NULL AND u.app_generation_id IS NOT NULL)::int AS noncanonical_or_historical_usage_records,
      count(*) FILTER (WHERE g.billing_status = 'settled' AND u.id IS NULL)::int AS settled_generation_without_usage,
      count(*) FILTER (WHERE g.known_usage IS NOT NULL AND u.id IS NOT NULL
        AND ((g.known_usage->>'inputTokens')::int <> u.input_tokens
          OR (g.known_usage->>'outputTokens')::int <> u.output_tokens))::int AS token_mismatches
    FROM thread_chat.usage_records u
    FULL JOIN thread_chat.conversation_generations g
      ON g.id = u.app_generation_id`
  const legacy = await legacyTableState()
  const [statExtension] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) AS installed`
  let legacyDatabaseQueries = {
    available: false,
    calls: null,
    totalExecTimeMs: null,
  }
  if (statExtension?.installed)
    try {
      const [stats] = await sql`
        SELECT COALESCE(sum(calls), 0)::bigint AS calls,
          COALESCE(sum(total_exec_time), 0)::double precision AS total_exec_time_ms
        FROM pg_stat_statements
        WHERE query ~ 'thread_chat\\.(branch_trees|branch_generations|branch_message_feedback)'`
      legacyDatabaseQueries = {
        available: true,
        calls: Number(stats?.calls ?? 0),
        totalExecTimeMs: Number(stats?.total_exec_time_ms ?? 0),
      }
    } catch {
      // 扩展存在但当前角色可能没有读取权限；明确报告 unavailable，不猜零调用。
    }

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        mode: "read-only",
        observedAt: new Date().toISOString(),
        database: {
          host: parsedUrl.hostname,
          name: parsedUrl.pathname.slice(1),
        },
        canonical: {
          generationStatus,
          generationRisks,
          outbox,
          commands,
          usage,
        },
        legacy: {
          rows: legacy,
          databaseQueries: legacyDatabaseQueries,
          runtimeReferenceFiles: legacyRuntimeReferenceCount(),
        },
        unavailableFromDatabase: [
          "authority_mismatch request rate",
          "HTTP command error rate",
          "revision/idempotency conflict rate",
          "legacy route request rate",
        ],
      },
      null,
      2
    )
  )
} finally {
  await sql.end()
}
