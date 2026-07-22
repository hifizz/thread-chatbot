import { config } from "dotenv"
import postgres from "postgres"

const SCHEMA = "thread_chat"
const CONFIRMATION = "--confirm-thread-chat"

config({ path: ".env.local" })

if (!process.argv.includes(CONFIRMATION)) {
  console.error(
    `[db:reset-schema] 该操作会永久删除 ${SCHEMA} schema 及其中全部数据。\n` +
      `确认后请运行：pnpm db:reset-schema -- ${CONFIRMATION}`
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
  console.log(`[db:reset-schema] 正在删除 ${target} 中的 ${SCHEMA} schema…`)
  await sql`DROP SCHEMA IF EXISTS ${sql(SCHEMA)} CASCADE`
  console.log(
    `[db:reset-schema] ${SCHEMA} 已删除；其他 schema 与 Drizzle 迁移账本未改动。`
  )
} finally {
  await sql.end()
}
