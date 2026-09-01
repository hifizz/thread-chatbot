import assert from "node:assert/strict"
import test from "node:test"

import {
  THREAD_QUOTE_MAX_COMMENT_CHARACTERS,
  THREAD_QUOTE_MAX_COUNT,
} from "../../constants/thread-chat-quote.ts"
import {
  parseThreadQuoteData,
  ThreadQuoteParseError,
} from "../../lib/thread-chat/domain/thread-quote.ts"
import {
  quoteContentToModelText,
  threadQuotePartToModelText,
} from "../../lib/thread-chat/application/quote-model.ts"
import { buildUserParts } from "../../lib/thread-chat/application/command-utils.ts"
import {
  forkThreadCommandSchema,
  sendMessageCommandSchema,
} from "../../lib/thread-chat/contracts/commands.ts"
import {
  addComposerQuote,
  composerDraftToSubmission,
  emptyThreadComposerDraft,
  isComposerDraftSendable,
  moveComposerQuote,
  removeComposerQuote,
  updateComposerQuoteComment,
} from "../../app/thread-chat/chat/composer/quote-draft.ts"

const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  thread: "22222222-2222-4222-8222-222222222222",
  message: "33333333-3333-4333-8333-333333333333",
  quote: "44444444-4444-4444-8444-444444444444",
  artifact: "55555555-5555-4555-8555-555555555555",
  command: "66666666-6666-4666-8666-666666666666",
  user: "77777777-7777-4777-8777-777777777777",
  assistant: "88888888-8888-4888-8888-888888888888",
  child: "99999999-9999-4999-8999-999999999999",
}

const anchor = {
  quote: { exact: "shared prefix", prefix: "before ", suffix: " after" },
  position: { start: 7, end: 20 },
}

function messageQuote(overrides = {}) {
  return {
    schemaVersion: "thread-quote-v1",
    quoteId: ids.quote,
    kind: "selection",
    text: anchor.quote.exact,
    source: {
      type: "message-selection",
      projectId: ids.project,
      threadId: ids.thread,
      messageId: ids.message,
      anchor,
    },
    ...overrides,
  }
}

function selection(index = 0, comment) {
  const suffix = String(index).padStart(12, "0")
  return {
    source: {
      type: "message-selection",
      sourceMessageId: `33333333-3333-4333-8333-${suffix}`,
      anchor: {
        quote: {
          exact: `quote-${index}`,
          prefix: "",
          suffix: "",
        },
      },
    },
    ...(comment ? { comment } : {}),
  }
}

test("parses V1 and legacy quote payloads", () => {
  const current = parseThreadQuoteData(messageQuote({ comment: "compare" }))
  assert.equal(current.schemaVersion, "thread-quote-v1")
  assert.equal(current.comment, "compare")
  assert.equal(current.source?.threadId, ids.thread)

  const legacy = parseThreadQuoteData({ text: "old quote" })
  assert.equal(legacy.schemaVersion, "legacy")
  assert.equal(legacy.source, null)
})

test("rejects malformed, unknown-version and mismatched quote payloads", () => {
  assert.throws(
    () => parseThreadQuoteData(messageQuote({ text: "not the anchor" })),
    ThreadQuoteParseError
  )
  assert.throws(
    () =>
      parseThreadQuoteData({
        ...messageQuote(),
        schemaVersion: "thread-quote-v2",
      }),
    ThreadQuoteParseError
  )
  assert.throws(
    () =>
      parseThreadQuoteData({
        ...messageQuote(),
        comment: "x".repeat(THREAD_QUOTE_MAX_COMMENT_CHARACTERS + 1),
      }),
    ThreadQuoteParseError
  )
})

test("serializes quote content deterministically without navigation metadata", () => {
  const text = 'line 1\n```ts\n</thread_quote>\n```\n"quoted"'
  const serialized = quoteContentToModelText({ text, comment: "review" })
  assert.equal(serialized, quoteContentToModelText({ text, comment: "review" }))
  assert.match(serialized, /thread-quote-model-v1/)
  assert.match(serialized, /review/)
  assert.doesNotMatch(serialized, /33333333-3333/)

  const fromPart = threadQuotePartToModelText(messageQuote({ comment: "review" }))
  assert.match(fromPart, /shared prefix/)
  assert.doesNotMatch(fromPart, /messageId|threadId|position|quoteId/)
})

test("buildUserParts preserves Quote -> Text -> File order", () => {
  const parts = buildUserParts({
    text: "question",
    quotes: [messageQuote()],
    files: [
      {
        url: "/api/attachments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mediaType: "text/plain",
        filename: "a.txt",
      },
    ],
  })
  assert.deepEqual(
    parts.map((part) => part.type),
    ["data-quote", "text", "file"]
  )
})

test("send command supports up to fifty current-thread selections", () => {
  const base = {
    commandId: ids.command,
    userMessageId: ids.user,
    assistantMessageId: ids.assistant,
    modelId: "model",
    text: "compare",
    files: [],
  }
  assert.equal(
    sendMessageCommandSchema.parse({
      ...base,
      quotes: Array.from({ length: THREAD_QUOTE_MAX_COUNT }, (_, index) =>
        selection(index)
      ),
    }).quotes.length,
    THREAD_QUOTE_MAX_COUNT
  )
  assert.throws(() =>
    sendMessageCommandSchema.parse({
      ...base,
      quotes: Array.from({ length: THREAD_QUOTE_MAX_COUNT + 1 }, (_, index) =>
        selection(index)
      ),
    })
  )
  assert.throws(() =>
    sendMessageCommandSchema.parse({
      ...base,
      text: "",
      quotes: [selection(1)],
    })
  )
  assert.equal(
    sendMessageCommandSchema.parse({
      ...base,
      text: "",
      quotes: [selection(1, "fix this")],
    }).quotes.length,
    1
  )
})

test("strict quote input rejects sourceThreadId and stopped-state is not client-selectable", () => {
  assert.throws(() =>
    sendMessageCommandSchema.parse({
      commandId: ids.command,
      userMessageId: ids.user,
      assistantMessageId: ids.assistant,
      modelId: "model",
      text: "question",
      files: [],
      quotes: [
        {
          ...selection(1),
          sourceThreadId: ids.thread,
        },
      ],
    })
  )
})

test("empty fork command does not require a first turn", () => {
  const parsed = forkThreadCommandSchema.parse({
    commandId: ids.command,
    threadId: ids.child,
    sourceMessageId: ids.message,
    anchorText: anchor.quote.exact,
    anchor,
    modelId: "model",
  })
  assert.equal(parsed.firstTurn, undefined)
})

test("composer draft keeps required origin and emits one canonical submission", () => {
  let draft = emptyThreadComposerDraft()
  const origin = {
    draftId: "origin",
    origin: "branch-origin",
    source: null,
    previewText: "parent quote",
    comment: "",
    required: true,
  }
  const first = {
    draftId: "q1",
    origin: "manual-selection",
    source: selection(1).source,
    previewText: "quote-1",
    comment: "",
    required: false,
  }
  const second = {
    draftId: "q2",
    origin: "artifact-annotation",
    source: {
      type: "artifact-selection",
      artifactId: ids.artifact,
      anchor,
    },
    previewText: anchor.quote.exact,
    comment: "revise",
    required: false,
  }

  draft = addComposerQuote(draft, origin).draft
  draft = addComposerQuote(draft, first).draft
  const duplicate = addComposerQuote(draft, { ...first, draftId: "duplicate" })
  assert.equal(duplicate.existingDraftId, "q1")
  draft = addComposerQuote(draft, second).draft
  assert.equal(removeComposerQuote(draft, "origin"), draft)
  draft = moveComposerQuote(draft, "q2", 1)
  assert.deepEqual(
    draft.quotes.map((quote) => quote.draftId),
    ["origin", "q2", "q1"]
  )
  draft = updateComposerQuoteComment(draft, "q1", "compare")
  assert.equal(isComposerDraftSendable(draft), true)
  const submission = composerDraftToSubmission(draft)
  assert.equal(submission.quotes.length, 2)
  assert.equal(submission.quotes[0]?.comment, "revise")
  assert.equal(submission.quotes[1]?.comment, "compare")
  assert.equal(
    submission.quotes.some((quote) => "sourceThreadId" in quote.source),
    false
  )
})
