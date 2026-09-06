import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { selectionComposerQuote, appendSelectionQuote } from "../../lib/thread-chat/selection-composer.ts"
import { messageContentInputSchema, messageContentToUiParts } from "../../lib/thread-chat/contracts/message-content.ts"
import { SelectionToolbar } from "../../app/thread-chat/branching/selection/selection-toolbar.tsx"
import { computePopupPosition } from "../../app/thread-chat/branching/selection/bubble-position.ts"
import { SELECTION_TOOLBAR_WIDTH } from "../../constants/selection-toolbar.ts"

const selection = {
  text: "保留当前草稿", msgId: "10000000-0000-4000-8000-000000000050",
  anchor: { quote: { exact: "保留当前草稿", prefix: "先", suffix: "再继续" }, position: { start: 1, end: 7 } },
}
const quote = selectionComposerQuote(selection)
assert.equal(quote.schemaVersion, "thread-quote-v1")
assert.deepEqual(quote.source.anchor, selection.anchor)
assert.notEqual(quote.source.anchor, selection.anchor, "引用拥有独立快照")
const quotes = appendSelectionQuote([], quote)
assert.equal(appendSelectionQuote(quotes, structuredClone(quote)), quotes, "相同选区不重复添加")
assert.equal(appendSelectionQuote(quotes, selectionComposerQuote({ ...selection, msgId: "10000000-0000-4000-8000-000000000051" })).length, 2)
assert.throws(() => selectionComposerQuote({ ...selection, text: "篡改选文" }))
assert.throws(() => selectionComposerQuote({ ...selection, text: "长".repeat(20001), anchor: { quote: { exact: "长".repeat(20001), prefix: "", suffix: "" } } }))
const content = messageContentInputSchema.parse({ parts: [
  { type: "quote", quote },
  { type: "text", text: "已有草稿，请继续说明" },
  { type: "artifact-reference", artifactId: "10000000-0000-4000-8000-000000000010" },
  { type: "file", file: { url: "/api/attachments/test", mediaType: "text/plain", filename: "笔记.txt" } },
] })
assert.deepEqual(content.parts.map(p => p.type), ["quote", "text", "artifact-reference", "file"])
assert.equal(messageContentToUiParts({ parts: content.parts.slice(0, 2) })[0].type, "data-quote")
const markup = renderToStaticMarkup(React.createElement(SelectionToolbar, { onContinue() {}, onAsk() {} }))
assert.equal((markup.match(/<button/g) ?? []).length, 4)
assert.equal((markup.match(/aria-disabled="true"/g) ?? []).length, 2)
assert.equal((markup.match(/role="tooltip"/g) ?? []).length, 2)
assert.match(markup, /收藏（开发中）/)
assert.match(markup, /马克笔（开发中）/)
const options = { sides: ["top", "bottom"], gap: 10, safePadding: 12 }
for (const width of [280, 320, 390, 1440]) {
  const popup = { width: Math.min(SELECTION_TOOLBAR_WIDTH, width - 24), height: 44 }
  for (const left of [0, width - 10]) {
    const result = computePopupPosition({ left, top: 200, width: 10, height: 24 }, popup, { left: 0, top: 0, width, height: 600 }, options)
    assert.equal(result.side, "top")
    assert.ok(result.left >= 12 && result.left + popup.width <= width - 12)
    assert.equal(result.overlapArea, 0)
  }
}
assert.equal(computePopupPosition({ left: 30, top: 12, width: 40, height: 24 }, { width: 280, height: 44 }, { left: 0, top: 0, width: 390, height: 600 }, options).side, "bottom")
console.log("PASS selection toolbar: four actions, disabled placeholders, quote snapshots/deduplication, mixed payload and viewport placement")
