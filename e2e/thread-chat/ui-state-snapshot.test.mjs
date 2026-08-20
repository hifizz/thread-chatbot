import assert from "node:assert/strict"
import { createTreeUiStateSnapshot } from "../../app/thread-chat/orchestration/workspace/ui-state-snapshot.ts"

const slots = [{ id: "main", folded: false }]
const widths = { main: 420 }
const source = {
  slots,
  widths,
  forceCols: 3,
  mode: "replace",
  viewMode: "canvas",
  ignored: "not persisted",
}
const snapshot = createTreeUiStateSnapshot(source)

assert.deepEqual(snapshot, {
  slots,
  widths,
  forceCols: 3,
  mode: "replace",
  viewMode: "canvas",
})
assert.equal(snapshot.slots, slots)
assert.equal(snapshot.widths, widths)
assert.equal("ignored" in snapshot, false)

console.log(
  "PASS  UI persistence snapshots exactly the five tree-scoped workspace fields"
)
