import assert from "node:assert/strict"
import {
  addArtifactAnnotationsToDraft,
  addCurrentThreadMessageQuote,
  branchOriginDraftFromThread,
  composerDraftToSubmission,
  draftWithBranchOrigin,
  emptyThreadComposerDraft,
} from "../../app/thread-chat/chat/composer/thread-composer-draft.ts"

const id = () => crypto.randomUUID()
const threadA = id()
const threadB = id()
const messageA1 = id()
const artifactA = id()
const exact = "当前 Thread 中的选区"
const anchor = {
  quote: { exact, prefix: "前文", suffix: "后文" },
  position: { start: 10, end: 10 + exact.length },
}

let draft = addCurrentThreadMessageQuote(emptyThreadComposerDraft(), {
  draftId: "message-quote",
  destinationThreadId: threadA,
  sourceThreadId: threadA,
  sourceMessageId: messageA1,
  anchor,
  previewText: exact,
  comment: "解释这段",
})
assert.equal(draft.quotes.length, 1)
assert.equal(draft.quotes[0].origin, "manual-selection")

assert.throws(
  () =>
    addCurrentThreadMessageQuote(draft, {
      draftId: "cross-thread",
      destinationThreadId: threadA,
      sourceThreadId: threadB,
      sourceMessageId: id(),
      anchor,
      previewText: exact,
    }),
  /COMPOSER_CROSS_THREAD_QUOTE_NOT_SUPPORTED/
)

draft = addArtifactAnnotationsToDraft(draft, [
  {
    draftId: "annotation-1",
    destinationThreadId: threadA,
    artifactSourceThreadId: threadA,
    artifactId: artifactA,
    anchor: {
      quote: { exact: "第一段", prefix: "", suffix: "" },
      position: { start: 0, end: 3 },
    },
    previewText: "第一段",
    comment: "补充证据",
  },
  {
    draftId: "annotation-2",
    destinationThreadId: threadA,
    artifactSourceThreadId: threadA,
    artifactId: artifactA,
    anchor: {
      quote: { exact: "第二段", prefix: "", suffix: "" },
      position: { start: 20, end: 23 },
    },
    previewText: "第二段",
    comment: "与前文冲突",
  },
])
assert.equal(draft.quotes.length, 3)
assert.deepEqual(
  draft.quotes.map((quote) => quote.comment),
  ["解释这段", "补充证据", "与前文冲突"]
)

assert.throws(
  () =>
    addArtifactAnnotationsToDraft(draft, [
      {
        draftId: "cross-artifact",
        destinationThreadId: threadA,
        artifactSourceThreadId: threadB,
        artifactId: id(),
        anchor,
        previewText: exact,
        comment: "不允许跨 Thread",
      },
    ]),
  /COMPOSER_CROSS_THREAD_QUOTE_NOT_SUPPORTED/
)

const forkThread = {
  id: threadB,
  parentId: threadA,
  forkMessageId: messageA1,
  forkAnchor: anchor,
  anchorText: exact,
}
const origin = branchOriginDraftFromThread(forkThread)
assert.equal(origin?.required, true)
assert.equal(origin?.source.sourceMessageId, messageA1)
const forkDraft = draftWithBranchOrigin(emptyThreadComposerDraft(), forkThread)
assert.equal(forkDraft.quotes.length, 1)
assert.equal(forkDraft.quotes[0].required, true)
assert.throws(() => composerDraftToSubmission(forkDraft), /NOT_SENDABLE/)

const batchSubmission = composerDraftToSubmission({
  ...draft,
  text: "请一次性处理所有批注",
})
assert.equal(batchSubmission.quotes.length, 3)
assert.equal(batchSubmission.text, "请一次性处理所有批注")
assert.equal(
  batchSubmission.quotes.filter(
    (quote) => quote.source.type === "artifact-selection"
  ).length,
  2
)

const branchSubmission = composerDraftToSubmission({
  ...forkDraft,
  text: "为什么？",
})
assert.equal(branchSubmission.quotes.length, 0, "origin 由服务端从 Fork 字段生成")
assert.equal(branchSubmission.text, "为什么？")

console.log("PASS current-thread quote composer draft contracts")
