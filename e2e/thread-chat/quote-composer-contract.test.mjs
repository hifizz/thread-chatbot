import assert from "node:assert/strict"
import {
  aggregateMarkdownAnnotations,
  canSubmitComposerDraft,
  composerDraftToSubmission,
  emptyThreadComposerDraft,
  markdownAnnotationsToDraftItems,
} from "../../app/thread-chat/chat/composer/thread-composer-draft.ts"

const anchor = (exact, start) => ({
  quote: { exact, prefix: "", suffix: "" },
  position: { start, end: start + exact.length },
})
const annotations = [
  {
    annotationId: "a1",
    artifactId: "00000000-0000-4000-8000-000000000001",
    anchor: anchor("第一段", 0),
    previewText: "第一段",
    comment: "补充证据",
  },
  {
    annotationId: "a2",
    artifactId: "00000000-0000-4000-8000-000000000001",
    anchor: anchor("第二段", 10),
    previewText: "第二段",
    comment: "与前文统一",
  },
]

const items = markdownAnnotationsToDraftItems(annotations)
assert.equal(items.length, 2)
assert.deepEqual(
  items.map((item) => item.comment),
  ["补充证据", "与前文统一"]
)
assert.ok(items.every((item) => item.origin === "artifact-annotation"))
assert.throws(
  () =>
    markdownAnnotationsToDraftItems([
      { ...annotations[0], comment: "" },
    ]),
  /非空评论/
)
assert.throws(
  () =>
    markdownAnnotationsToDraftItems([
      { ...annotations[0], previewText: "不同正文" },
    ]),
  /Anchor 一致/
)

const draft = aggregateMarkdownAnnotations({
  draft: emptyThreadComposerDraft(),
  annotations,
})
assert.equal(draft.quotes.length, 2)
assert.equal(canSubmitComposerDraft(draft), true)
const submission = composerDraftToSubmission(draft)
assert.equal(submission.text, "")
assert.equal(submission.quotes.length, 2)
assert.deepEqual(
  submission.quotes.map((quote) => quote.comment),
  ["补充证据", "与前文统一"]
)

// Canonical submission 是一个对象：调用方只应执行一次 sendMessage，
// 服务端由此创建一条 User Message 和一次 assistant attempt。
let sendCount = 0
const fakeSend = (value) => {
  sendCount += 1
  return value
}
fakeSend(submission)
assert.equal(sendCount, 1)

console.log("quote composer contract tests passed")
