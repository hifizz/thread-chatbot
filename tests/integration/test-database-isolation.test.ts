import { afterAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import {
  assertSafeTestDatabaseUrl,
  TEST_DATABASE_NAME,
} from "../../scripts/lib/test-database-safety.mjs"

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const sql = postgres(testDatabaseUrl, { max: 1 })

afterAll(async () => {
  await sql.end()
})

describe("PostgreSQL 测试库隔离", () => {
  it("实际连接 thread-chat-test，且 thread_chat schema 已由 db:push 建立", async () => {
    const [database] = await sql<{ name: string }[]>`
      select current_database() as name
    `
    const [schema] = await sql<{ exists: boolean }[]>`
      select exists(
        select 1
        from information_schema.schemata
        where schema_name = 'thread_chat'
      ) as exists
    `

    expect(database.name).toBe(TEST_DATABASE_NAME)
    expect(schema.exists).toBe(true)
  })
})
