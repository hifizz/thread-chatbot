import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const shell = await readFile(
  new URL("../../app/thread-chat/thread-chat-demo.tsx", import.meta.url),
  "utf8"
)
const runtime = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/workspace/use-thread-chat-runtime.ts",
    import.meta.url
  ),
  "utf8"
)

assert.match(shell, /useThreadChatRuntime\(/)
for (const capability of [
  "createChatController",
  "saveTreeStrict",
  "useGenerationReconciliation",
  "useTreePersistence",
  "useThreadTitles",
]) {
  assert.doesNotMatch(shell, new RegExp(`${capability}\\(`))
  assert.match(runtime, new RegExp(`${capability}\\(`))
}

console.log(
  "PASS  page shell consumes one composed thread-chat runtime capability"
)
