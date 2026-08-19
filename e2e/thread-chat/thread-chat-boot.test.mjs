import assert from "node:assert/strict"
import {
  threadChatBootSeed,
  threadChatBootSeedOrFallback,
} from "../../app/thread-chat/net/thread-chat-boot.ts"

const empty = threadChatBootSeed({ state: null, generations: [] })
assert.equal(empty.schemaVersion, 2)
assert.deepEqual(Object.keys(empty.threads), ["main"])
assert.equal(empty.threads.main.activeLeafMessageId, null)

const stored = structuredClone(empty)
stored.threads.main.title = "restored"
const restored = threadChatBootSeed({ state: stored, generations: [] })
assert.equal(restored.threads.main.title, "restored")
assert.equal(restored.schemaVersion, 2)

const invalidWarnings = []
const fallback = threadChatBootSeedOrFallback(
  {
    state: { ...stored, schemaVersion: 1 },
    generations: [],
  },
  (error) => invalidWarnings.push(error)
)
assert.equal(fallback.schemaVersion, 2)
assert.deepEqual(Object.keys(fallback.threads), ["main"])
assert.equal(invalidWarnings.length, 1)

console.log(
  "PASS  thread chat boot selects empty, sanitized, or invalid-state fallback seed"
)
