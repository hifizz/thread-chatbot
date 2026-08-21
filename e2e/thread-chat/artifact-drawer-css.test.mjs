import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const actions = readFileSync(
  new URL("../../app/thread-chat/styles/message-actions.css", import.meta.url),
  "utf8"
)
const drawer = readFileSync(
  new URL("../../app/thread-chat/styles/drawer.css", import.meta.url),
  "utf8"
)

assert.doesNotMatch(actions, /\.historical-artifact/)
assert.equal(
  drawer.match(/\.tc \.historical-artifact\s*\{/g)?.length,
  1
)
assert.match(drawer, /\.historical-artifact[\s\S]*?font-size:\s*9px;/)

console.log(
  "PASS  historical artifact badge styles are owned only by the artifact drawer"
)
