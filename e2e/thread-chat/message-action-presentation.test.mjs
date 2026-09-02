import assert from "node:assert/strict"
import { buildMessageActionViewState } from "../../app/thread-chat/chat/actions/message-action-presentation.ts"

const state = {
  threads: {
    main: {
      id: "main",
      parentId: null,
      forkFromMsgId: null,
      children: ["child-a", "child-b"],
      messages: [
        {
          id: "user-1",
          parentMessageId: null,
          role: "user",
          text: "question",
          forks: [],
        },
        {
          id: "assistant-a",
          parentMessageId: "user-1",
          role: "assistant",
          text: "first",
          forks: [],
        },
        {
          id: "assistant-b",
          parentMessageId: "user-1",
          role: "assistant",
          text: "second",
          forks: [],
        },
      ],
      activeLeafMessageId: "assistant-b",
    },
    "child-a": {
      id: "child-a",
      parentId: "main",
      forkFromMsgId: "assistant-a",
      children: [],
      messages: [],
      activeLeafMessageId: null,
    },
    "child-b": {
      id: "child-b",
      parentId: "main",
      forkFromMsgId: "assistant-b",
      children: [],
      messages: [],
      activeLeafMessageId: null,
    },
  },
}
const recoverable = new Map([["user-1", { generationId: "generation-1" }]])
const feedback = new Map([["assistant-b", "positive"]])

const view = buildMessageActionViewState({
  state,
  recoverableByUserMessageId: recoverable,
  feedbackByMessageId: feedback,
})

assert.equal(view.recoverableByUserMessageId, recoverable)
assert.equal(view.feedbackByMessageId, feedback)
assert.deepEqual(view.activePathByThreadId.get("main"), [
  "user-1",
  "assistant-b",
])
assert.deepEqual(view.presentationByThreadId.get("main"), {
  latestUserMessageId: "user-1",
  latestAssistantMessageId: "assistant-b",
  sourceProvenance: null,
})
assert.deepEqual(view.presentationByThreadId.get("child-a").sourceProvenance, {
  sourceThreadId: "main",
  sourceMessageId: "assistant-a",
  isOnActivePath: false,
  alternativeIndex: 0,
  alternativeCount: 2,
})

console.log(
  "PASS  message action presentation derives active paths, latest turn, and provenance without variant UI state"
)
