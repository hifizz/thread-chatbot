import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const messages = readFileSync(
  new URL("../../app/thread-chat/styles/messages.css", import.meta.url),
  "utf8"
)
const artifactCard = readFileSync(
  new URL("../../app/thread-chat/styles/artifact-card.css", import.meta.url),
  "utf8"
)
const artifactComponent = readFileSync(
  new URL(
    "../../app/thread-chat/orchestration/artifacts/markdown-artifact-card.tsx",
    import.meta.url
  ),
  "utf8"
)
const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)

assert.doesNotMatch(messages, /\.acard/)
assert.equal(artifactCard.match(/\.tc \.acard\s*\{/g)?.length, 1)
assert.equal(artifactCard.match(/\.tc \.acard-progress\s*\{/g)?.length, 1)
assert.doesNotMatch(artifactComponent, /style=\{\{\s*display:\s*"block"/)
assert.equal(
  entry.match(/@import "\.\/styles\/artifact-card\.css";/g)?.length,
  1
)
assert.ok(
  entry.indexOf('messages.css"') < entry.indexOf('artifact-card.css"') &&
    entry.indexOf('artifact-card.css"') < entry.indexOf('message-actions.css"')
)

console.log(
  "PASS  artifact card styles have one owner immediately after message styles"
)
