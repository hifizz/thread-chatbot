import { config } from "dotenv"
import postgres from "postgres"

const SCHEMA = "thread_chat"
const CONFIRMATION = "--confirm-thread-chat"
const CANONICAL_ONLY = "--canonical-only"
const CANONICAL_TABLES = [
  "thread_forks",
  "conversation_messages",
  "conversation_turns",
  "conversation_threads",
  "conversations",
  "projects",
  "workspace_members",
  "workspaces",
]

config({ path: ".env.local" })

if (!process.argv.includes(CONFIRMATION)) {
  console.error(
    `[db:reset-schema] 该操作会永久删除 ${SCHEMA} schema 及其中全部数据。\n` +
      `确认后请运行：pnpm db:reset-schema -- ${CONFIRMATION}\n` +
      `若只重置 Issue #34 规范表：pnpm db:reset-schema -- ${CANONICAL_ONLY} ${CONFIRMATION}`
  )
  process.exit(1)
}

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!rawUrl) {
  console.error(
    "[db:reset-schema] 未配置 DIRECT_URL 或 DATABASE_URL，已停止执行。"
  )
  process.exit(1)
}

const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/, "$2")

let target
try {
  const url = new URL(databaseUrl)
  target = `${url.hostname}/${url.pathname.slice(1)}`
} catch {
  console.error("[db:reset-schema] 数据库连接串不是合法 URL，已停止执行。")
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  if (process.argv.includes(CANONICAL_ONLY)) {
    console.log(
      `[db:reset-schema] 正在删除 ${target} 的 ${SCHEMA} schema 中 Issue #34 规范表…`
    )
    await sql.begin(async (transaction) => {
      for (const table of CANONICAL_TABLES)
        await transaction`DROP TABLE IF EXISTS ${transaction(SCHEMA)}.${transaction(table)} CASCADE`
      await transaction`DROP FUNCTION IF EXISTS ${transaction(SCHEMA)}.${transaction("validate_turn_message_roles")}() CASCADE`
      await transaction`DROP FUNCTION IF EXISTS ${transaction(SCHEMA)}.${transaction("validate_conversation_integrity")}() CASCADE`
      await transaction`DROP FUNCTION IF EXISTS ${transaction(SCHEMA)}.${transaction("reject_canonical_reparenting")}() CASCADE`
    })
    console.log(
      `[db:reset-schema] 规范表已删除；legacy、认证、计费、其他 schema 与 Drizzle 迁移账本未改动。`
    )
  } else {
    console.log(`[db:reset-schema] 正在删除 ${target} 中的 ${SCHEMA} schema…`)
    await sql`DROP SCHEMA IF EXISTS ${sql(SCHEMA)} CASCADE`
    console.log(
      `[db:reset-schema] ${SCHEMA} 已删除；其他 schema 与 Drizzle 迁移账本未改动。`
    )
  }
} finally {
  await sql.end()
}
