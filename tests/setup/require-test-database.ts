import {
  assertSafeTestDatabaseUrl,
  loadTestDatabaseEnvironment,
} from "../../scripts/lib/test-database-safety.mjs"

loadTestDatabaseEnvironment()
const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
process.env.DATABASE_URL = testDatabaseUrl
