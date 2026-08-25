import {
  assertSafeTestDatabaseUrl,
  loadTestDatabaseEnvironment,
} from "../../scripts/lib/test-database-safety.mjs"

loadTestDatabaseEnvironment()
assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
