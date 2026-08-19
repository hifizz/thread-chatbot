import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { CANVAS_EXPAND_WIDTH } from "../../app/thread-chat/orchestration/canvas-dimensions.ts"

const node = readFileSync(
  new URL(
    "../../app/thread-chat/orchestration/canvas-node.tsx",
    import.meta.url
  ),
  "utf8"
)
const canvas = readFileSync(
  new URL(
    "../../app/thread-chat/orchestration/thread-canvas.tsx",
    import.meta.url
  ),
  "utf8"
)
const css = readFileSync(
  new URL("../../app/thread-chat/styles/canvas.css", import.meta.url),
  "utf8"
)

assert.equal(CANVAS_EXPAND_WIDTH, 340)
assert.match(node, /--canvas-expand-width/)
assert.match(canvas, /node\.initialWidth \?\? CANVAS_EXPAND_WIDTH/)
assert.match(css, /width:\s*var\(--canvas-expand-width\)/)
assert.doesNotMatch(css, /width:\s*340px/)
assert.doesNotMatch(node, /\bEXPAND_W\b/)

console.log("PASS  canvas panel layout and CSS consume one 340px width source")
