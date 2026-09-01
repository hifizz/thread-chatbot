import assert from "node:assert/strict"
import test from "node:test"

import { buildUserParts } from "../../lib/thread-chat/application/command-utils.ts"
import { buildBranchOriginQuote } from "../../lib/thread-chat/application/quote-resolver.ts"
import { threadQuotePartToModelText } from "../../lib/thread-chat/application/quote-model.ts"

const projectId = "11111111-1111-4111-8111-111111111111"
const parentThreadId = "22222222-2222-4222-8222-222222222222"
const sourceMessageId = "33333333-3333-4333-8333-333333333333"
const quoteId = "44444444-4444-4444-8444-444444444444"
const anchor = {
  quote: {
    exact: "Prompt Cache reuses a stable prefix.",
    prefix: "Before: ",
    suffix: " After.",
  },
  position: { start: 8, end: 43 },
}

function origin() {
  return buildBranchOriginQuote({
    projectId,
    parentThreadId,
    sourceMessageId,
    anchor,
    anchorText: anchor.quote.exact,
    createId: () => quoteId,
  })
}

function modelText(parts) {
  return parts
    .flatMap((part) => {
      if (part.type === "data-quote") {
        return [threadQuotePartToModelText(part.data)]
      }
      if (part.type === "text") return [part.text]
      return []
    })
    .join("\n")
}

test("popup firstTurn and empty-fork later send produce the same B1 model text", () => {
  // Path A: forkThread(firstTurn) creates the server-derived origin immediately.
  const directFirstTurn = buildUserParts({
    text: "Why must the prefix be identical?",
    files: [],
    quotes: [origin()],
  })

  // Path B: an empty Fork stores only topology; sendMessage later derives the
  // same origin from those fields before constructing B1.
  const emptyForkThenSend = buildUserParts({
    text: "Why must the prefix be identical?",
    files: [],
    quotes: [origin()],
  })

  assert.deepEqual(directFirstTurn, emptyForkThenSend)
  assert.equal(modelText(directFirstTurn), modelText(emptyForkThenSend))
  assert.deepEqual(
    directFirstTurn.map((part) => part.type),
    ["data-quote", "text"]
  )
})
