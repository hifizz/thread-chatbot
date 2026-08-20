import assert from "node:assert/strict"
import { prepareAssistantRetry } from "../../app/thread-chat/net/commands/regeneration-command.ts"

function state(activeLeafMessageId = "a1") {
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
        messages: [
          {
            id: "u1",
            parentMessageId: null,
            role: "user",
            text: "question",
            forks: [],
          },
          {
            id: "a1",
            parentMessageId: "u1",
            role: "assistant",
            text: "answer",
            forks: [],
            status: "done",
          },
          {
            id: "a-old",
            parentMessageId: "u1",
            role: "assistant",
            text: "old",
            forks: [],
            status: "done",
          },
        ],
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

const prepared = prepareAssistantRetry(state(), {
  threadId: "main",
  sourceAssistantMessageId: "a1",
  assistantMessageId: "a2",
  generationId: "11111111-1111-4111-8111-111111111111",
})
assert.equal(prepared.ok, true)
assert.equal(prepared.start.userMessageId, "u1")
assert.equal(prepared.start.messageId, "a2")
assert.equal(prepared.start.action.intent.kind, "regenerate-assistant")
assert.equal(prepared.start.action.sourceAssistantMessageId, "a1")
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

assert.deepEqual(
  prepareAssistantRetry(state(), {
    threadId: "main",
    sourceAssistantMessageId: "missing",
    assistantMessageId: "a2",
    generationId: "g2",
  }),
  { ok: false, code: "not_found", message: "回复不存在" }
)

assert.deepEqual(
  prepareAssistantRetry(state("a1"), {
    threadId: "main",
    sourceAssistantMessageId: "a-old",
    assistantMessageId: "a2",
    generationId: "g2",
  }),
  {
    ok: false,
    code: "not_latest_turn",
    message: "只能重新生成当前最后一轮回复",
  }
)

assert.deepEqual(
  prepareAssistantRetry(state(), {
    threadId: "main",
    sourceAssistantMessageId: "u1",
    assistantMessageId: "a2",
    generationId: "g2",
  }),
  { ok: false, code: "not_found", message: "回复不存在" }
)

console.log(
  "PASS  assistant retry command prepares one append-only sibling or stable not-found/not-latest failures"
)
