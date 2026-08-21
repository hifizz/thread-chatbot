import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const route = await readFile(
  new URL("../../app/api/branch-trees/route.ts", import.meta.url),
  "utf8"
)
const repository = await readFile(
  new URL(
    "../../lib/thread-chat-generation/tree-repository.ts",
    import.meta.url
  ),
  "utf8"
)

assert.match(route, /listOwnedTreeSummaries\(userId\)/)
assert.doesNotMatch(route, /drizzle-orm|@\/lib\/db|branchTrees/)
assert.match(repository, /function listOwnedTreeSummaries/)
assert.match(repository, /jsonb_object_keys/)
assert.match(repository, /\.limit\(100\)/)

console.log("PASS  tree list route delegates persistence to the repository")
