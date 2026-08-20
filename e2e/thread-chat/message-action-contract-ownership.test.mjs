import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../../app/thread-chat/", import.meta.url)
const contract = await readFile(
  new URL("chat/message-action-commands.ts", root),
  "utf8"
).catch(() => "")

assert.match(contract, /export interface ThreadMessageActionCommands/)
assert.match(contract, /export type GenerationActionResult/)
assert.match(contract, /export type VariantSwitchResult/)

for (const path of [
  "chat/message-action-types.ts",
  "chat/use-message-actions.ts",
  "chat/conversation-message.tsx",
  "chat/chat-view.tsx",
  "branching/branchable-chat.tsx",
  "orchestration/canvas-actions.ts",
]) {
  const source = await readFile(new URL(path, root), "utf8")
  assert.doesNotMatch(
    source,
    /net\/chat-controller/,
    `${path} must consume the chat-layer action capability contract`
  )
}

const controller = await readFile(
  new URL("net/chat-controller.ts", root),
  "utf8"
)
assert.match(controller, /chat\/message-action-commands/)
assert.doesNotMatch(controller, /export interface ThreadMessageActionCommands/)

console.log(
  "PASS  message action capability contract belongs to chat and net only implements it"
)
