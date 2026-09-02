import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

const topbar = readFileSync(
  new URL("../../app/thread-chat/styles/topbar.css", import.meta.url),
  "utf8"
)
const canvas = readFileSync(
  new URL("../../app/thread-chat/styles/canvas.css", import.meta.url),
  "utf8"
)
const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)
const legacyHelpUrl = new URL(
  "../../app/thread-chat/styles/topbar-help.css",
  import.meta.url
)

assert.equal(topbar.match(/\.tc \.seg button\.mode\s*\{/g)?.length, 1)
assert.match(
  topbar,
  /\.tc \.seg button\.mode\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*5px;/
)
assert.doesNotMatch(canvas, /\.seg button\.mode/)
assert.equal(topbar.match(/\.tc \.tbtn\.help\s*\{/g)?.length, 1)
assert.equal(topbar.match(/\.tc \.tbtn\.help:hover\s*\{/g)?.length, 1)
assert.doesNotMatch(entry, /topbar-help\.css/)
assert.equal(existsSync(legacyHelpUrl), false)

console.log("PASS  topbar controls are owned only by topbar.css")
