import assert from "node:assert/strict"
import test from "node:test"

import {
  buildBranchOriginQuote,
  materializeQuoteSelections,
} from "../../lib/thread-chat/application/quote-resolver.ts"

const projectId = "11111111-1111-4111-8111-111111111111"
const threadId = "22222222-2222-4222-8222-222222222222"
const otherThreadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const messageId = "33333333-3333-4333-8333-333333333333"
const otherMessageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const artifactId = "44444444-4444-4444-8444-444444444444"
const anchor = {
  quote: { exact: "selected text", prefix: "before", suffix: "after" },
  position: { start: 7, end: 20 },
}

function selection(sourceMessageId = messageId, comment) {
  return {
    source: { type: "message-selection", sourceMessageId, anchor },
    ...(comment ? { comment } : {}),
  }
}

function records(status = "completed") {
  return new Map([
    [
      messageId,
      {
        id: messageId,
        projectId,
        threadId,
        role: "assistant",
        status,
      },
    ],
    [
      otherMessageId,
      {
        id: otherMessageId,
        projectId,
        threadId: otherThreadId,
        role: "assistant",
        status: "completed",
      },
    ],
  ])
}

function materialize(input = {}) {
  return materializeQuoteSelections({
    destinationProjectId: projectId,
    destinationThreadId: threadId,
    selections: [selection()],
    messagesById: records(),
    artifactsById: new Map(),
    createId: () => "55555555-5555-4555-8555-555555555555",
    ...input,
  })
}

test("accepts completed assistant content from the destination thread", () => {
  const [quote] = materialize()
  assert.equal(quote.kind, "selection")
  assert.equal(quote.text, anchor.quote.exact)
  assert.equal(quote.source.threadId, threadId)
})

test("rejects generating, stopped and failed assistant sources", () => {
  for (const status of ["generating", "stopped", "failed"]) {
    assert.throws(() => materialize({ messagesById: records(status) }))
  }
})

test("rejects a completed assistant message from another thread", () => {
  assert.throws(() =>
    materialize({
      selections: [selection(otherMessageId)],
    })
  )
})

test("accepts only markdown artifacts whose completed source belongs to destination thread", () => {
  const artifactSelection = {
    source: { type: "artifact-selection", artifactId, anchor },
    comment: "revise this",
  }
  const [quote] = materialize({
    selections: [artifactSelection],
    artifactsById: new Map([
      [
        artifactId,
        {
          id: artifactId,
          projectId,
          sourceMessageId: messageId,
          kind: "markdown",
        },
      ],
    ]),
  })
  assert.equal(quote.source.type, "artifact-selection")
  assert.equal(quote.comment, "revise this")

  assert.throws(() =>
    materialize({
      selections: [artifactSelection],
      artifactsById: new Map([
        [
          artifactId,
          {
            id: artifactId,
            projectId,
            sourceMessageId: otherMessageId,
            kind: "markdown",
          },
        ],
      ]),
    })
  )
})

test("deduplicates identical source anchors while preserving first comment", () => {
  const quotes = materialize({
    selections: [selection(messageId, "first"), selection(messageId, "second")],
  })
  assert.equal(quotes.length, 1)
  assert.equal(quotes[0].comment, "first")
})

test("branch origin is server-derived and preserves the parent source", () => {
  const quote = buildBranchOriginQuote({
    projectId,
    parentThreadId: otherThreadId,
    sourceMessageId: otherMessageId,
    anchor,
    anchorText: anchor.quote.exact,
    createId: () => "55555555-5555-4555-8555-555555555555",
  })
  assert.equal(quote.kind, "branch-origin")
  assert.equal(quote.source.threadId, otherThreadId)
  assert.equal(quote.source.messageId, otherMessageId)
  assert.throws(() =>
    buildBranchOriginQuote({
      projectId,
      parentThreadId: otherThreadId,
      sourceMessageId: otherMessageId,
      anchor,
      anchorText: "different",
    })
  )
})
