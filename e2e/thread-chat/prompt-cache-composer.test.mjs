import assert from "node:assert/strict"
import test from "node:test"

import {
  addComposerQuotes,
  artifactAnnotationsToDraftItems,
  branchOriginDraftFromThread,
  composerDraftToSubmission,
  emptyThreadComposerDraft,
} from "../../app/thread-chat/chat/composer/quote-draft.ts"

const threadId = "11111111-1111-4111-8111-111111111111"
const parentId = "22222222-2222-4222-8222-222222222222"
const messageId = "33333333-3333-4333-8333-333333333333"
const artifactId = "44444444-4444-4444-8444-444444444444"
const anchor = {
  quote: { exact: "selected", prefix: "before", suffix: "after" },
  position: { start: 7, end: 15 },
}

test("an empty fork reconstructs one required branch-origin draft block", () => {
  const item = branchOriginDraftFromThread({
    id: threadId,
    parentId,
    forkMessageId: messageId,
    forkAnchor: anchor,
    anchorText: anchor.quote.exact,
  })
  assert.ok(item)
  assert.equal(item.required, true)
  assert.equal(item.origin, "branch-origin")
  assert.equal(item.source, null)
  assert.equal(item.previewText, anchor.quote.exact)
})

test("main thread does not invent a branch-origin block", () => {
  assert.equal(
    branchOriginDraftFromThread({
      id: threadId,
      parentId: null,
      forkMessageId: null,
      forkAnchor: null,
      anchorText: null,
    }),
    null
  )
})

test("artifact annotations aggregate into the artifact source thread draft", () => {
  const items = artifactAnnotationsToDraftItems({
    destinationThreadId: threadId,
    artifactSourceThreadId: threadId,
    artifactId,
    annotations: [
      { anchor, previewText: "selected", comment: "add evidence" },
      {
        anchor: {
          quote: { exact: "second", prefix: "", suffix: "" },
        },
        previewText: "second",
        comment: "resolve conflict",
      },
    ],
    createDraftId: (() => {
      let index = 0
      return () => `annotation-${index++}`
    })(),
  })
  const draft = addComposerQuotes(emptyThreadComposerDraft(), items)
  const submission = composerDraftToSubmission(draft)
  assert.equal(submission.text, "")
  assert.equal(submission.quotes.length, 2)
  assert.deepEqual(
    submission.quotes.map((quote) => quote.comment),
    ["add evidence", "resolve conflict"]
  )
})

test("artifact annotations cannot target another thread composer", () => {
  assert.throws(() =>
    artifactAnnotationsToDraftItems({
      destinationThreadId: threadId,
      artifactSourceThreadId: parentId,
      artifactId,
      annotations: [
        { anchor, previewText: "selected", comment: "comment" },
      ],
    })
  )
})
