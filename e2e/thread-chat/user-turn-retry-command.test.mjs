import assert from "node:assert/strict"
import { prepareUserTurnRetry } from "../../app/thread-chat/net/commands/regeneration-command.ts"

function state(messages, activeLeafMessageId) {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.3",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages,
        activeLeafMessageId,
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 1,
    tick: 1,
  }
}

const orphanUser = {
  id: "u1",
  parentMessageId: null,
  role: "user",
  text: "question",
  forks: [],
}
const prepared = prepareUserTurnRetry(state([orphanUser], "u1"), {
  threadId: "main",
  userMessageId: "u1",
  assistantMessageId: "a2",
  generationId: "11111111-1111-4111-8111-111111111111",
})
assert.equal(prepared.ok, true)
assert.equal(prepared.start.action.intent.kind, "retry-orphan-user")
assert.equal(prepared.start.action.sourceUserMessageId, "u1")
assert.deepEqual(prepared.start.action.patch.addedMessages, [
  {
    id: "a2",
    parentMessageId: "u1",
    role: "assistant",
    text: "",
    forks: [],
    generationId: "11111111-1111-4111-8111-111111111111",
    status: "pending",
  },
])

const completedAssistant = {
  id: "a1",
  parentMessageId: "u1",
  role: "assistant",
  text: "answer",
  forks: [],
  status: "done",
}
assert.deepEqual(
  prepareUserTurnRetry(state([orphanUser, completedAssistant], "a1"), {
    threadId: "main",
    userMessageId: "u1",
    assistantMessageId: "a2",
    generationId: "g2",
  }),
  {
    ok: false,
    code: "not_latest_turn",
    message: "该消息已不是可恢复的最后一轮",
  }
)

assert.deepEqual(
  prepareUserTurnRetry(state([orphanUser], "u1"), {
    threadId: "main",
    userMessageId: "missing",
    assistantMessageId: "a2",
    generationId: "g2",
  }),
  {
    ok: false,
    code: "not_latest_turn",
    message: "该消息已不是可恢复的最后一轮",
  }
)

console.log(
  "PASS  user-turn retry command prepares one pending assistant only for the recoverable active orphan"
)
