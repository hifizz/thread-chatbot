import { defineConfig } from "drizzle-kit"
import { DB_SCHEMA } from "./lib/db/pg-schema"
import {
  assertSafeTestDatabaseUrl,
  loadTestDatabaseEnvironment,
} from "./scripts/lib/test-database-safety.mjs"

loadTestDatabaseEnvironment()

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle-test",
  dialect: "postgresql",
  dbCredentials: { url: testDatabaseUrl },
  schemaFilter: [DB_SCHEMA],
})
