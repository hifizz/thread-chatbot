import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const messages = readFileSync(
  new URL("../../app/thread-chat/styles/messages.css", import.meta.url),
  "utf8"
)
const selectionExtras = readFileSync(
  new URL("../../app/thread-chat/styles/selection-extras.css", import.meta.url),
  "utf8"
)

assert.equal(
  messages.match(/\.tc \.message\.user \.msg-quote\s*\{/g)?.length,
  1
)
assert.match(
  messages,
  /\.msg-quote[\s\S]*?-webkit-line-clamp:\s*2;[\s\S]*?overflow:\s*hidden;/
)
assert.doesNotMatch(selectionExtras, /\.msg-quote/)

console.log("PASS  user message quote styles are owned only by messages.css")
