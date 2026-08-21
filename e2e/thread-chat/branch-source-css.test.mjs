import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const actions = readFileSync(
  new URL("../../app/thread-chat/styles/message-actions.css", import.meta.url),
  "utf8"
)
const source = readFileSync(
  new URL("../../app/thread-chat/styles/branch-source.css", import.meta.url),
  "utf8"
)
const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)

assert.doesNotMatch(actions, /\.inactive-source/)
assert.equal(source.match(/\.tc \.inactive-source(?: button)?\s*\{/g)?.length, 2)
assert.equal(
  entry.match(/@import "\.\/styles\/branch-source\.css";/g)?.length,
  1
)
assert.ok(
  entry.indexOf('message-actions.css"') < entry.indexOf('branch-source.css"')
)

console.log(
  "PASS  inactive branch source styles have one owner immediately after message actions"
)
