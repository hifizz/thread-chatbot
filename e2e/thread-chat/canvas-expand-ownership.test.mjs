import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const [node, expand, actions, canvas] = await Promise.all([
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/canvas-node.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/canvas-expand.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/canvas-actions.ts",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/thread-canvas.tsx",
      import.meta.url
    ),
    "utf8"
  ),
])

assert.match(node, /<CanvasExpand/)
assert.doesNotMatch(
  node,
  /ConversationComposer|ConversationMessage|createContext|useEffect/
)
assert.match(expand, /ConversationComposer/)
assert.match(expand, /ConversationMessage/)
assert.match(expand, /STICK_THRESHOLD = 40/)
assert.match(actions, /createContext<CanvasActions \| null>/)
assert.match(canvas, /from "\.\/canvas-actions"/)

console.log(
  "PASS  canvas card composes separately owned expansion and action capabilities"
)
