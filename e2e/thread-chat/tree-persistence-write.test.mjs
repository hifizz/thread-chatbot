import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { emptySeedState } from "../../app/thread-chat/core/seed.ts"
import {
  getKnownTreeRevision,
  saveTree,
  saveTreeStrict,
  setKnownTreeRevision,
} from "../../app/thread-chat/net/persist.ts"

const source = await readFile(
  new URL("../../app/thread-chat/net/persist.ts", import.meta.url),
  "utf8"
)
assert.equal(
  source.match(/method: "PUT"/g)?.length,
  1,
  "one shared PUT primitive should own the tree write protocol"
)

const treeId = "11111111-1111-4111-8111-111111111111"
const calls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) })
  return Response.json({ ok: true, revision: calls.length })
}

try {
  setKnownTreeRevision(treeId, 0)
  await saveTreeStrict(treeId, emptySeedState(), "strict")
  await saveTree(treeId, emptySeedState(), "best effort")
} finally {
  globalThis.fetch = originalFetch
}

assert.equal(calls.length, 2)
assert.deepEqual(
  calls.map((call) => [call.init.method, call.body.title, call.body.baseRevision]),
  [
    ["PUT", "strict", 0],
    ["PUT", "best effort", 1],
  ]
)
assert.equal(getKnownTreeRevision(treeId), 2)

console.log(
  "PASS  strict and best-effort tree saves share one revision-aware PUT primitive"
)
