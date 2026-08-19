import assert from "node:assert/strict"
import { columnCountChoices } from "../../app/thread-chat/orchestration/thread-chat-topbar-logic.ts"

assert.deepEqual(columnCountChoices(null), [
  { value: "auto", label: "自适应", active: true },
  { value: 2, label: "2", active: false },
  { value: 3, label: "3", active: false },
  { value: 4, label: "4", active: false },
])
assert.deepEqual(
  columnCountChoices(3).filter((choice) => choice.active),
  [{ value: 3, label: "3", active: true }]
)

console.log(
  "PASS  Thread Chat topbar exposes one active auto/forced column choice"
)
