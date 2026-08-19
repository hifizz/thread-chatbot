import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const topbar = readFileSync(
  new URL("../../app/thread-chat/styles/topbar.css", import.meta.url),
  "utf8"
)
const canvas = readFileSync(
  new URL("../../app/thread-chat/styles/canvas.css", import.meta.url),
  "utf8"
)

assert.equal(topbar.match(/\.tc \.seg button\.mode\s*\{/g)?.length, 1)
assert.match(
  topbar,
  /\.tc \.seg button\.mode\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*5px;/
)
assert.doesNotMatch(canvas, /\.seg button\.mode/)

console.log("PASS  topbar mode button styles are owned only by topbar.css")
