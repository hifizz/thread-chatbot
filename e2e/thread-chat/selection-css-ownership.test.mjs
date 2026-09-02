import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

const selection = readFileSync(
  new URL("../../app/thread-chat/styles/selection.css", import.meta.url),
  "utf8"
)
const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)
const legacyExtrasUrl = new URL(
  "../../app/thread-chat/styles/selection-extras.css",
  import.meta.url
)

assert.equal(selection.match(/\.tc \.sel-bubble \.place-hint\s*\{/g)?.length, 1)
assert.doesNotMatch(entry, /selection-extras\.css/)
assert.equal(existsSync(legacyExtrasUrl), false)

console.log("PASS  selection bubble styles are owned only by selection.css")
