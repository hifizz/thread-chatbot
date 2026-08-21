import assert from "node:assert/strict"
import { createTreeSaveGate } from "../../app/thread-chat/net/persistence/tree-save-gate.ts"

const normal = createTreeSaveGate()
normal.markPending()
assert.equal(normal.takePendingFlush(), true)
assert.equal(normal.takePendingFlush(), false)

const debounced = createTreeSaveGate()
debounced.markPending()
assert.equal(debounced.finishDebounce(), true)
assert.equal(debounced.takePendingFlush(), false)

const deleted = createTreeSaveGate()
deleted.markPending()
deleted.setSuppressed(true)
assert.equal(deleted.isSuppressed(), true)
assert.equal(deleted.finishDebounce(), false)
assert.equal(deleted.takePendingFlush(), false)
deleted.setSuppressed(false)
assert.equal(deleted.isSuppressed(), false)

console.log(
  "PASS  tree save gate flushes once and suppression clears pending resurrection writes"
)
