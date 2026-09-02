import { config } from "dotenv"
import postgres from "postgres"

const TEST_DATABASE_NAME = "thread-chat-normalized-test"
const DB_SCHEMA = "thread_chat"
const resetSchema = process.argv.includes("--reset-schema")

config({ path: ".env.local" })

const source = (process.env.DIRECT_URL || process.env.DATABASE_URL || "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2")

if (!source) {
  throw new Error("缺少 DIRECT_URL 或 DATABASE_URL")
}

const adminUrl = new URL(source)
adminUrl.pathname = "/postgres"
adminUrl.searchParams.delete("options")

const admin = postgres(adminUrl.toString(), { max: 1 })
try {
  const [existing] = await admin`
    select 1 as present
    from pg_database
    where datname = ${TEST_DATABASE_NAME}
  `
  if (!existing) {
    await admin`create database ${admin(TEST_DATABASE_NAME)}`
    console.log(`[db:test:setup] 已创建 database ${TEST_DATABASE_NAME}`)
  } else {
    console.log(`[db:test:setup] database ${TEST_DATABASE_NAME} 已存在`)
  }
} finally {
  await admin.end()
}

const testUrl = new URL(source)
testUrl.pathname = `/${TEST_DATABASE_NAME}`
testUrl.searchParams.delete("options")

const testDb = postgres(testUrl.toString(), { max: 1 })
try {
  if (resetSchema) {
    await testDb`drop schema if exists ${testDb(DB_SCHEMA)} cascade`
    await testDb`drop schema if exists drizzle cascade`
    await testDb`create schema ${testDb(DB_SCHEMA)}`
    console.log(`[db:test:setup] 已重置 ${DB_SCHEMA} schema 与 migration 账本`)
  } else {
    await testDb`create schema if not exists ${testDb(DB_SCHEMA)}`
  }
  await testDb`create extension if not exists vector`
  console.log(`[db:test:setup] ${DB_SCHEMA} schema 与 vector 扩展已就绪`)
} finally {
  await testDb.end()
}
