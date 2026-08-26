import { defineConfig } from "drizzle-kit"
import { config } from "dotenv"
import { DB_SCHEMA } from "./lib/db/pg-schema"

config({ path: ".env.local" })

const TEST_DATABASE_NAME = "thread-chat-normalized-test"
const source = (process.env.DIRECT_URL || process.env.DATABASE_URL || "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2")

if (!source) {
  throw new Error("[drizzle.test.config] 缺少 DIRECT_URL 或 DATABASE_URL")
}

const testUrl = new URL(source)
testUrl.pathname = `/${TEST_DATABASE_NAME}`
testUrl.searchParams.set(
  "options",
  `-c search_path=${DB_SCHEMA},public,extensions`
)

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: testUrl.toString() },
  schemaFilter: [DB_SCHEMA],
})
