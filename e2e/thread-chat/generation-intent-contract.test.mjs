import assert from "node:assert/strict"
import { threadChatGenerationIntentSchema } from "../../lib/thread-chat/contracts/generation-intent.ts"

const validCases = [
  { kind: "persisted-turn" },
  {
    kind: "regenerate-assistant",
    sourceAssistantMessageId: "assistant-1",
  },
  { kind: "retry-orphan-user" },
  {
    kind: "edit-last-user",
    sourceUserMessageId: "user-1",
    text: "  revised question  ",
  },
]

for (const intent of validCases) {
  assert.equal(threadChatGenerationIntentSchema.safeParse(intent).success, true)
}

const edited = threadChatGenerationIntentSchema.parse(validCases[3])
assert.equal(edited.kind, "edit-last-user")
assert.equal(edited.text, "revised question")

const invalidCases = [
  { kind: "unknown" },
  { kind: "regenerate-assistant" },
  { kind: "regenerate-assistant", sourceAssistantMessageId: "" },
  { kind: "edit-last-user", sourceUserMessageId: "user-1", text: "   " },
  { kind: "edit-last-user", sourceUserMessageId: "", text: "question" },
]

for (const intent of invalidCases) {
  assert.equal(
    threadChatGenerationIntentSchema.safeParse(intent).success,
    false
  )
}

console.log(
  "PASS  generation intent schema accepts four commands, trims edit text, and rejects incomplete variants"
)
