import assert from "node:assert/strict"
import { threadChatGenerationIdentitySchema } from "../../lib/thread-chat/contracts/generation-identity.ts"

const valid = {
  anchorText: null,
  treeId: "11111111-1111-4111-8111-111111111111",
  threadId: "main",
  userMessageId: "user-1",
  assistantMessageId: "assistant-1",
  generationId: "22222222-2222-4222-8222-222222222222",
  intent: { kind: "persisted-turn" },
}
assert.deepEqual(threadChatGenerationIdentitySchema.parse(valid), valid)

for (const invalid of [
  { ...valid, treeId: "not-a-uuid" },
  { ...valid, generationId: "not-a-uuid" },
  { ...valid, threadId: "" },
  { ...valid, userMessageId: "" },
  { ...valid, assistantMessageId: "" },
  { ...valid, intent: { kind: "regenerate-assistant" } },
]) {
  assert.equal(
    threadChatGenerationIdentitySchema.safeParse(invalid).success,
    false
  )
}

console.log(
  "PASS  Thread Chat generation identity composes UUIDs, turn ids, anchor, and intent"
)
