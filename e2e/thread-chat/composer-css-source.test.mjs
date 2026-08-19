import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const component = readFileSync(
  new URL(
    "../../app/thread-chat/chat/conversation-composer.tsx",
    import.meta.url
  ),
  "utf8"
)
const columnCss = readFileSync(
  new URL("../../app/thread-chat/styles/composer.css", import.meta.url),
  "utf8"
)
const canvasCss = readFileSync(
  new URL("../../app/thread-chat/styles/canvas.css", import.meta.url),
  "utf8"
)

assert.match(component, /--composer-max-height/)
assert.match(columnCss, /max-height:\s*var\(--composer-max-height\)/)
assert.match(canvasCss, /max-height:\s*var\(--composer-max-height\)/)
assert.doesNotMatch(columnCss, /max-height:\s*120px/)
assert.doesNotMatch(canvasCss, /max-height:\s*68px/)

console.log(
  "PASS  conversation composer JS and both surfaces share one max-height source"
)
