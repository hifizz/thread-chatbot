import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../../app/thread-chat/", import.meta.url)
const contract = await readFile(
  new URL("chat/actions/message-action-commands.ts", root),
  "utf8"
).catch(() => "")

assert.match(contract, /export interface ThreadMessageActionCommands/)
assert.match(contract, /export type GenerationActionResult/)
assert.doesNotMatch(contract, /VariantSwitchResult|switchTurnVariant/)

for (const path of [
  "chat/actions/message-action-types.ts",
  "chat/actions/use-message-actions.ts",
  "chat/message/conversation-message.tsx",
  "chat/chat-view.tsx",
  "branching/branchable-chat.tsx",
  "orchestration/canvas/canvas-actions.ts",
]) {
  const source = await readFile(new URL(path, root), "utf8")
  assert.doesNotMatch(
    source,
    /net\/chat-controller/,
    `${path} must consume the chat-layer action capability contract`
  )
}

const production = await readFile(new URL("thread-chat-demo.tsx", root), "utf8")
const commands = await readFile(
  new URL("net/commands/conversation-commands.ts", root),
  "utf8"
)
assert.match(production, /ThreadMessageActionCommands/)
assert.match(commands, /createConversationCommands/)
assert.doesNotMatch(production, /net\/chat-controller|switchTurnVariant/)

console.log(
  "PASS  message action contract belongs to chat, omits variant switching, and normalized commands implement it"
)
