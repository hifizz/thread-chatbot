import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const component = await readFile(
  new URL("../../app/thread-chat/branching/selection/selection-bubble.tsx", import.meta.url),
  "utf8"
)
const observer = await readFile(
  new URL(
    "../../app/thread-chat/branching/selection/use-assistant-text-selection.ts",
    import.meta.url
  ),
  "utf8"
)

assert.doesNotMatch(component, /document\.addEventListener\((?:"|')mouse/)
assert.doesNotMatch(component, /document\.addEventListener\((?:"|')scroll/)
assert.match(component, /useAssistantTextSelection\(/)
assert.match(observer, /document\.addEventListener\("mouseup"/)
assert.match(observer, /document\.addEventListener\("mousedown"/)
assert.match(observer, /document\.addEventListener\("scroll"/)
assert.match(observer, /describeRange\(/)

console.log(
  "PASS  SelectionBubble composes one dedicated DOM selection observer"
)
