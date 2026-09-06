import assert from "node:assert/strict"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite"
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { pushSchema } from "drizzle-kit/api"
import * as schema from "../../lib/db/schema.ts"

/** 仅接受显式提供的、空白且以 snapshot_sharing_ 命名的独立测试库。 */
export async function sharingDatabase() {
  const url = process.env.SNAPSHOT_SHARING_TEST_DATABASE_URL
  if (!url) {
    const client = await PGlite.create({ extensions: { vector } })
    await client.exec("CREATE EXTENSION vector")
    const db = pgliteDrizzle(client, { schema })
    await (await pushSchema(schema, db, ["thread_chat"])).apply()
    return { db, close: () => client.close(), sql: null }
  }
  assert.match(new URL(url).pathname, /^\/snapshot_sharing_[a-z0-9_]+$/)
  const sql = postgres(url, { max: 6, prepare: false, connection: { application_name: "snapshot-sharing-test", search_path: "thread_chat,public", statement_timeout: 15000 } })
  try {
    const tables = await sql`select tablename from pg_tables where schemaname in ('public', 'thread_chat')`
    assert.equal(tables.length, 0, "只允许初始化空白测试库，不重置已有数据库")
    await sql`create extension if not exists vector`
    const db = postgresDrizzle(sql, { schema })
    // Drizzle Kit 的 API 读取 result.rows；postgres-js 直接返回行数组。
    const pushAdapter = { execute: async (query) => ({ rows: await db.execute(query) }) }
    await (await pushSchema(schema, pushAdapter, ["thread_chat"])).apply()
    return { db, sql, close: () => sql.end({ timeout: 5 }) }
  } catch (error) { await sql.end({ timeout: 5 }); throw error }
}
