import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { THREAD_TREE_SCHEMA_VERSION } from "../../constants/thread-chat.ts"

const typesUrl = new URL(
  "../../lib/thread-chat/domain/types.ts",
  import.meta.url
)
const seedUrl = new URL("../../app/thread-chat/core/seed.ts", import.meta.url)

test("thread tree type, parser, and seed share one schema version", async () => {
  const [types, seed] = await Promise.all([
    readFile(typesUrl, "utf8"),
    readFile(seedUrl, "utf8"),
  ])

  assert.equal(THREAD_TREE_SCHEMA_VERSION, 2)
  assert.match(types, /schemaVersion:\s*typeof THREAD_TREE_SCHEMA_VERSION/)
  assert.match(seed, /schemaVersion:\s*THREAD_TREE_SCHEMA_VERSION/)
  assert.doesNotMatch(types, /schemaVersion:\s*2/)
  assert.doesNotMatch(seed, /schemaVersion:\s*2/)
})
