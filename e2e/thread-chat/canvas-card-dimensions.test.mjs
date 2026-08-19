import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  CANVAS_CARD_BASE_HEIGHT,
  CANVAS_CARD_DIMENSIONS,
  CANVAS_CARD_INNER_WIDTH,
} from "../../app/thread-chat/orchestration/canvas-card-dimensions.ts"

const layoutUrl = new URL(
  "../../app/thread-chat/orchestration/use-canvas-layout.ts",
  import.meta.url
)
const nodeUrl = new URL(
  "../../app/thread-chat/orchestration/canvas-node.tsx",
  import.meta.url
)
const cssUrl = new URL(
  "../../app/thread-chat/styles/canvas.css",
  import.meta.url
)

test("canvas card layout and CSS share one dimension source", async () => {
  const [layout, node, css] = await Promise.all([
    readFile(layoutUrl, "utf8"),
    readFile(nodeUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ])

  assert.equal(CANVAS_CARD_DIMENSIONS.width, 280)
  assert.equal(CANVAS_CARD_INNER_WIDTH, 250)
  assert.equal(CANVAS_CARD_BASE_HEIGHT, 24)
  assert.match(layout, /width: CANVAS_CARD_DIMENSIONS\.width/)
  assert.match(layout, /CANVAS_CARD_INNER_WIDTH \/ fontPx/)
  assert.match(node, /"--canvas-card-width":/)
  assert.match(node, /"--canvas-card-summary-max-lines":/)
  assert.match(css, /width:\s*var\(--canvas-card-width\)/)
  assert.match(css, /padding:\s*var\(--canvas-card-padding-block\)/)
  assert.match(
    css,
    /-webkit-line-clamp:\s*var\(--canvas-card-summary-max-lines\)/
  )
  assert.doesNotMatch(css, /width:\s*280px/)
  assert.doesNotMatch(css, /padding:\s*11px 13px/)
})
