import assert from "node:assert/strict"
import { assistantMessagePresentation } from "../../app/thread-chat/chat/conversation-message-logic.ts"

function assistant(overrides = {}) {
  return {
    id: "assistant-1",
    role: "assistant",
    text: "",
    status: "pending",
    ...overrides,
  }
}

assert.deepEqual(assistantMessagePresentation(assistant()), {
  hasVisibleText: false,
  hasVisibleContent: false,
  isWaitingForVisibleOutput: true,
  showBubble: true,
  showCaret: false,
})

assert.deepEqual(
  assistantMessagePresentation(
    assistant({ status: "streaming", text: "partial" })
  ),
  {
    hasVisibleText: true,
    hasVisibleContent: true,
    isWaitingForVisibleOutput: false,
    showBubble: true,
    showCaret: true,
  }
)

assert.deepEqual(
  assistantMessagePresentation(
    assistant({ status: "streaming", webResearch: [{ type: "search" }] })
  ),
  {
    hasVisibleText: false,
    hasVisibleContent: true,
    isWaitingForVisibleOutput: false,
    showBubble: true,
    showCaret: false,
  }
)

assert.deepEqual(
  assistantMessagePresentation(
    assistant({ status: "pending", artifactIds: ["artifact-1"] })
  ),
  {
    hasVisibleText: false,
    hasVisibleContent: false,
    isWaitingForVisibleOutput: false,
    showBubble: false,
    showCaret: false,
  }
)

console.log(
  "PASS  shared message presentation covers waiting, streaming, research, and artifact-only states"
)
