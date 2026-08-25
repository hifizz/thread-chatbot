import postgres from "postgres"
import {
  assertSafeTestDatabaseUrl,
  loadTestDatabaseEnvironment,
  TEST_DATABASE_NAME,
} from "./lib/test-database-safety.mjs"

loadTestDatabaseEnvironment()
const testDatabaseUrl = new URL(
  assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
)
const adminUrl = new URL(testDatabaseUrl)
adminUrl.pathname = "/postgres"

const sql = postgres(adminUrl.toString(), { max: 1 })

try {
  const existing = await sql`
    select 1
    from pg_database
    where datname = ${TEST_DATABASE_NAME}
  `

  if (existing.length === 0) {
    await sql.unsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`)
    console.log(`[test:db:create] 已创建 ${TEST_DATABASE_NAME}。`)
  } else {
    console.log(`[test:db:create] ${TEST_DATABASE_NAME} 已存在。`)
  }
} finally {
  await sql.end()
}
