import { spawnSync } from "node:child_process"
import postgres from "postgres"
import {
  assertSafeTestDatabaseUrl,
  loadTestDatabaseEnvironment,
} from "./lib/test-database-safety.mjs"

const TEST_SCHEMA = "thread_chat"

loadTestDatabaseEnvironment()
const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const sql = postgres(testDatabaseUrl, { max: 1 })

try {
  // vector 是当前 Schema 的数据库级扩展；只确保存在，不删除或修改其他 schema。
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  await sql`DROP SCHEMA IF EXISTS ${sql(TEST_SCHEMA)} CASCADE`
  // drizzle-kit 在 schemaFilter 指向不存在的 schema 时会在 introspection 阶段失败；
  // 先建立空 namespace，再由 push 从零创建其中的全部表与约束。
  await sql`CREATE SCHEMA ${sql(TEST_SCHEMA)}`
  console.log(`[test:db:reset] 已将测试库中的 ${TEST_SCHEMA} 重置为空 schema。`)
} finally {
  await sql.end()
}

const push = spawnSync(
  "pnpm",
  [
    "exec",
    "drizzle-kit",
    "push",
    "--config",
    "drizzle.test.config.ts",
    "--force",
  ],
  {
    env: { ...process.env, TEST_DATABASE_URL: testDatabaseUrl },
    encoding: "utf8",
  }
)

process.stdout.write(push.stdout ?? "")
process.stderr.write(push.stderr ?? "")
if (push.error) throw push.error
if (push.status !== 0) process.exit(push.status ?? 1)
if (
  /PostgresError|\bError:/.test(`${push.stdout ?? ""}\n${push.stderr ?? ""}`)
) {
  throw new Error("drizzle-kit push 输出了数据库错误。")
}

const verificationSql = postgres(testDatabaseUrl, { max: 1 })
try {
  const [schema] = await verificationSql`
    select
      exists(
        select 1
        from information_schema.schemata
        where schema_name = ${TEST_SCHEMA}
      ) as exists,
      (
        select count(*)::integer
        from information_schema.tables
        where table_schema = ${TEST_SCHEMA}
      ) as table_count
  `
  if (!schema?.exists || schema.table_count === 0) {
    throw new Error(
      `drizzle-kit push 返回成功，但 ${TEST_SCHEMA} schema 未完整建立。`
    )
  }
} finally {
  await verificationSql.end()
}

console.log("[test:db:reset] 测试 Schema 已从空状态重建。")
