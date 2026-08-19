import assert from "node:assert/strict"
import { prepareUserEdit } from "../../app/thread-chat/net/regeneration-command.ts"

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
            text: "original",
            quote: { text: "quoted" },
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

const originalState = state()
const prepared = prepareUserEdit(originalState, {
  threadId: "main",
  sourceUserMessageId: "u1",
  text: "  edited question  ",
  userMessageId: "u2",
  assistantMessageId: "a2",
  generationId: "11111111-1111-4111-8111-111111111111",
})
assert.equal(prepared.ok, true)
assert.equal(prepared.start.userMessageId, "u2")
assert.equal(prepared.start.action.intent.kind, "edit-last-user")
assert.equal(prepared.start.action.sourceUserMessageId, "u1")
assert.deepEqual(prepared.start.action.patch.addedMessages, [
  {
    id: "u2",
    parentMessageId: null,
    role: "user",
    text: "edited question",
    forks: [],
    quote: { text: "quoted" },
  },
  {
    id: "a2",
    parentMessageId: "u2",
    role: "assistant",
    text: "",
    forks: [],
    generationId: "11111111-1111-4111-8111-111111111111",
    status: "pending",
  },
])
assert.equal(originalState.threads.main.messages[0].text, "original")
assert.equal(originalState.threads.main.messages.length, 2)

for (const input of [
  { sourceUserMessageId: "missing", text: "edited" },
  { sourceUserMessageId: "u1", text: "   " },
]) {
  assert.deepEqual(
    prepareUserEdit(state(), {
      threadId: "main",
      ...input,
      userMessageId: "u2",
      assistantMessageId: "a2",
      generationId: "g2",
    }),
    {
      ok: false,
      code: "not_latest_turn",
      message: "只能编辑当前最后一轮用户消息",
    }
  )
}

console.log(
  "PASS  user edit command preserves source/quote and prepares trimmed user plus pending assistant siblings"
)
