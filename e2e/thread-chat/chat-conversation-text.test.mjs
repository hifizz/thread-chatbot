import assert from "node:assert/strict"
import {
  latestUserText,
  recentConversationText,
} from "../../app/api/chat/conversation-text.ts"
import { RESEARCH_ROUTER_CONTEXT_MESSAGES } from "../../constants/research.ts"

const messages = Array.from(
  { length: RESEARCH_ROUTER_CONTEXT_MESSAGES + 2 },
  (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [
      { type: "text", text: `text-${index}` },
      { type: "data-ignored", data: { index } },
    ],
  })
)

assert.equal(
  latestUserText(messages),
  `text-${messages.findLastIndex((message) => message.role === "user")}`
)

const recent = recentConversationText(messages)
assert.equal(recent.includes("text-0"), false)
assert.equal(recent.includes("text-1"), false)
assert.equal(recent.includes("text-2"), true)
assert.equal(recent.split("\n").length, RESEARCH_ROUTER_CONTEXT_MESSAGES)

assert.equal(latestUserText([]), "")
assert.equal(recentConversationText([]), "")

console.log(
  "PASS  chat conversation text keeps the latest user text and bounded recent context"
)
