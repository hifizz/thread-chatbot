import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const shell = await readFile(
  new URL("../../app/thread-chat/thread-chat-demo.tsx", import.meta.url),
  "utf8"
)
const workspace = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/use-thread-chat-workspace.ts",
    import.meta.url
  ),
  "utf8"
)

assert.match(shell, /useThreadChatWorkspace\(/)
for (const capability of [
  "useWindowWidth",
  "useColumnSlots",
  "useUiStatePersistence",
]) {
  assert.doesNotMatch(shell, new RegExp(`${capability}\\(`))
  assert.match(workspace, new RegExp(`${capability}\\(`))
}
assert.doesNotMatch(shell, /focusSeq/)
assert.match(workspace, /focusCanvasNode/)
assert.match(workspace, /CanvasChatActions/)
assert.match(workspace, /CanvasViewState/)

console.log(
  "PASS  page shell consumes one composed column/canvas workspace capability"
)
