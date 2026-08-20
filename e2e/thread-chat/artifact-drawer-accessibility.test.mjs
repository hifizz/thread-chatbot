import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/artifacts/artifact-drawer.tsx",
    import.meta.url
  ),
  "utf8"
)

assert.match(source, /role="dialog"/)
assert.match(source, /aria-labelledby=\{titleId\}/)
assert.match(source, /inert=\{!open\}/)
assert.match(source, /closeButtonRef\.current\?\.focus\(\)/)
assert.match(source, /returnFocusRef\.current\?\.focus\(\)/)

console.log(
  "PASS  artifact drawer removes closed controls from focus and restores trigger focus"
)
