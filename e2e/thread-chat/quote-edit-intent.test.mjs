import assert from "node:assert/strict"
import {
  buildUserParts,
  hasSendableUserParts,
  replaceUserEditableParts,
} from "../../lib/thread-chat/application/command-utils.ts"
import { buildBranchOriginQuote } from "../../lib/thread-chat/application/quote-resolver.ts"

const id = () => crypto.randomUUID()
const exact = "分支来源"
const origin = buildBranchOriginQuote({
  projectId: id(),
  parentThreadId: id(),
  sourceMessageId: id(),
  anchor: {
    quote: { exact, prefix: "", suffix: "" },
    position: { start: 0, end: exact.length },
  },
  anchorText: exact,
})

const original = buildUserParts({
  text: "为什么？",
  files: [],
  quotes: [origin],
})
const edited = replaceUserEditableParts({
  sourceParts: original,
  text: "请举例",
  files: [],
})
assert.equal(hasSendableUserParts(edited), true)
assert.deepEqual(edited[0], original[0], "edit preserves immutable quote snapshot")

const clearedOriginOnly = replaceUserEditableParts({
  sourceParts: original,
  text: "",
  files: [],
})
assert.equal(
  hasSendableUserParts(clearedOriginOnly),
  false,
  "origin without question or comment has no sendable user intent"
)

const commented = {
  ...origin,
  quoteId: id(),
  kind: "selection",
  comment: "逐条修改",
}
const commentOnly = buildUserParts({
  text: "",
  files: [],
  quotes: [commented],
})
assert.equal(hasSendableUserParts(commentOnly), true)

console.log("PASS quote edit intent contracts")
