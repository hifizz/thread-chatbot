import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { columnCountChoices } from "../../app/thread-chat/orchestration/navigation/thread-chat-topbar-logic.ts"

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

const [topbar, variantPicker] = await Promise.all([
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/navigation/thread-chat-topbar.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/chat/actions/turn-variant-picker.tsx",
      import.meta.url
    ),
    "utf8"
  ),
])
assert.match(topbar, /aria-label="视图模式"/)
assert.match(topbar, /aria-label="列数"/)
assert.match(topbar, /aria-pressed=\{viewMode === "columns"\}/)
assert.match(topbar, /aria-pressed=\{choice\.active\}/)
assert.match(topbar, /aria-pressed=\{placementMode === "replace"\}/)
assert.match(variantPicker, /role="group"[\s\S]*aria-label="回复版本切换"/)

console.log(
  "PASS  Thread Chat topbar exposes one active auto/forced column choice"
)
