import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const [columns, slots, workspace, actions] = await Promise.all([
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/thread-columns.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/use-column-slots.ts",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/use-thread-chat-workspace.ts",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/branch-workspace-actions.ts",
      import.meta.url
    ),
    "utf8"
  ),
])

assert.doesNotMatch(columns, /function useColumnSlots|\bplace\(/)
assert.doesNotMatch(columns, /ThreadStore/)
assert.match(slots, /export function useColumnSlots/)
assert.match(slots, /normalizeForReplace/)
assert.match(slots, /function commitWidths/)
assert.match(workspace, /from "\.\/use-column-slots"/)
assert.match(actions, /from "\.\/use-column-slots"/)

console.log(
  "PASS  column view composes a separately owned slot state capability"
)
