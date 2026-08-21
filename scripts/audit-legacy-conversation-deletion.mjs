import { spawnSync } from "node:child_process"

import { config } from "dotenv"
import postgres from "postgres"

config({ path: ".env.local", quiet: true })

const LEGACY_NAMES = [
  "branch_trees",
  "branch_generations",
  "branch_message_feedback",
]
const SEARCH_PATTERN =
  "branch_trees|branch_generations|branch_message_feedback|branchTrees|branchGenerations|branchMessageFeedback|ThreadTreeState"

function repositoryReferences() {
  const result = spawnSync(
    "rg",
    [
      "-l",
      SEARCH_PATTERN,
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.next/**",
      ".",
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  )
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`rg 退出码 ${result.status}: ${result.stderr}`)
  const paths = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replace(/^\.\//u, ""))
    .filter((path) => path !== "scripts/audit-legacy-conversation-deletion.mjs")
    .sort()
  const categories = {
    runtime: [],
    operational: [],
    schemaAndMigration: [],
    tests: [],
    documentationAndSpecs: [],
  }
  for (const path of paths) {
    if (
      path.includes(".test.") ||
      path.startsWith("e2e/") ||
      path.includes("/__tests__/")
    )
      categories.tests.push(path)
    else if (path.startsWith("scripts/")) categories.operational.push(path)
    else if (path.startsWith("drizzle/") || path === "lib/db/schema.ts")
      categories.schemaAndMigration.push(path)
    else if (
      path.startsWith("docs/") ||
      path.startsWith("openspec/") ||
      path === "CLAUDE.md"
    )
      categories.documentationAndSpecs.push(path)
    else categories.runtime.push(path)
  }
  return { total: paths.length, categories }
}

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2")
const parsedUrl = new URL(databaseUrl)
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  const tables = await sql`SELECT c.relname AS table_name,
      pg_total_relation_size(c.oid)::bigint AS size_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'thread_chat'
      AND c.relname IN ${sql(LEGACY_NAMES)}
    ORDER BY c.relname`
  // 行数必须精确，不能把 pg_class.reltuples 的估算值写进删除审批。
  const exactCounts = await sql`
    SELECT 'branch_trees' AS table_name, count(*)::int AS rows FROM thread_chat.branch_trees
    UNION ALL SELECT 'branch_generations', count(*)::int FROM thread_chat.branch_generations
    UNION ALL SELECT 'branch_message_feedback', count(*)::int FROM thread_chat.branch_message_feedback
    ORDER BY table_name`
  const countByTable = new Map(
    exactCounts.map((entry) => [entry.table_name, entry.rows])
  )

  const foreignKeys = await sql`SELECT conrelid::regclass::text AS child_table,
      conname AS constraint_name,
      confrelid::regclass::text AS parent_table,
      pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'f'
      AND (conrelid = ANY(ARRAY[
        'thread_chat.branch_trees'::regclass,
        'thread_chat.branch_generations'::regclass,
        'thread_chat.branch_message_feedback'::regclass
      ]) OR confrelid = ANY(ARRAY[
        'thread_chat.branch_trees'::regclass,
        'thread_chat.branch_generations'::regclass,
        'thread_chat.branch_message_feedback'::regclass
      ]))
    ORDER BY child_table, constraint_name`
  const indexes =
    await sql`SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'thread_chat'
      AND tablename IN ${sql(LEGACY_NAMES)}
    ORDER BY tablename, indexname`
  const triggers = await sql`
    SELECT event_object_table AS table_name, trigger_name, action_timing,
      event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE event_object_schema = 'thread_chat'
      AND event_object_table IN ${sql(LEGACY_NAMES)}
    ORDER BY event_object_table, trigger_name, event_manipulation`
  const views = await sql`
    SELECT schemaname, viewname
    FROM pg_views
    WHERE definition ~ 'branch_(trees|generations|message_feedback)'
    ORDER BY schemaname, viewname`
  const functions = await sql`
    SELECT n.nspname AS schema_name, p.proname AS function_name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind <> 'a'
      AND pg_get_functiondef(p.oid) ~ 'branch_(trees|generations|message_feedback)'
    ORDER BY n.nspname, p.proname`
  const similarRelations = await sql`
    SELECT n.nspname AS schema_name, c.relname AS relation_name,
      CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned-table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized-view'
        WHEN 'S' THEN 'sequence'
        ELSE c.relkind::text
      END AS relation_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'thread_chat'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND (c.relname ILIKE '%branch%'
        OR c.relname ILIKE '%tree%'
        OR c.relname ILIKE '%generation%'
        OR c.relname ILIKE '%feedback%')
    ORDER BY c.relname`
  const [pgCron] = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS installed`
  const databaseSchedules = pgCron?.installed
    ? await sql.unsafe(
        "SELECT jobid, schedule, command, active FROM cron.job " +
          "WHERE command ~ 'branch_(trees|generations|message_feedback)' ORDER BY jobid"
      )
    : []
  const [usage] = await sql`
    SELECT count(*)::int AS linked_records
    FROM thread_chat.usage_records u
    WHERE u.app_generation_id IN (
      SELECT id FROM thread_chat.branch_generations
    )`

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        mode: "read-only",
        database: {
          host: parsedUrl.hostname,
          name: parsedUrl.pathname.slice(1),
        },
        legacyTables: tables.map((entry) => ({
          table: entry.table_name,
          rows: countByTable.get(entry.table_name) ?? 0,
          sizeBytes: Number(entry.size_bytes),
        })),
        foreignKeys,
        indexes,
        triggers,
        views,
        functions,
        similarRelations,
        databaseSchedules,
        externalReferences: {
          usageRecordsLinkedByAppGenerationId: usage?.linked_records ?? 0,
          usageRecordsPolicy: "preserve-without-foreign-key",
        },
        repository: repositoryReferences(),
      },
      null,
      2
    )
  )
} finally {
  await sql.end()
}
