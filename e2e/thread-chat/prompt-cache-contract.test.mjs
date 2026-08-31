import assert from "node:assert/strict"
import {
  THREAD_QUOTE_MAX_COUNT,
  THREAD_QUOTE_MODEL_FORMAT_VERSION,
  THREAD_QUOTE_SCHEMA_VERSION,
} from "../../constants/thread-chat.ts"
import {
  forkThreadCommandSchema,
  sendMessageCommandSchema,
} from "../../lib/thread-chat/contracts/commands.ts"
import {
  parseThreadQuoteData,
  quoteSelectionKey,
} from "../../lib/thread-chat/domain/thread-quote.ts"
import {
  quoteContentToModelText,
  threadQuotePartToModelText,
} from "../../lib/thread-chat/application/quote-model.ts"
import {
  buildUserParts,
  replaceUserEditableParts,
} from "../../lib/thread-chat/application/command-utils.ts"
import {
  buildBranchOriginQuote,
  mergeBranchOriginQuote,
} from "../../lib/thread-chat/application/quote-resolver.ts"
import {
  assertPromptWindowBudget,
  assertQuoteBudget,
} from "../../lib/thread-chat/application/quote-budget.ts"
import {
  addComposerQuote,
  branchOriginDraftQuote,
  composerDraftToSubmission,
  emptyThreadComposerDraft,
  isComposerDraftSendable,
  moveComposerQuote,
  removeComposerQuote,
} from "../../app/thread-chat/chat/composer/thread-composer-draft.ts"
import {
  generationToolProfile,
  selectGenerationToolProfile,
} from "../../lib/thread-chat/streaming/generation-tools.ts"
import {
  buildPromptCacheControls,
  promptCacheAffinityKey,
} from "../../lib/ai/prompt-cache.ts"
import {
  canonicalHash,
  stablePrefixHash,
} from "../../lib/thread-chat/application/prompt-cache.ts"

const id = () => crypto.randomUUID()
const anchor = (exact = "相同前缀") => ({
  quote: { exact, prefix: "缓存需要", suffix: "才能复用" },
  position: { start: 4, end: 4 + exact.length },
})
const sourceMessageId = id()
const projectId = id()
const parentThreadId = id()

const origin = buildBranchOriginQuote({
  projectId,
  parentThreadId,
  sourceMessageId,
  anchor: anchor(),
  anchorText: "相同前缀",
  quoteId: id(),
})
assert.equal(origin.schemaVersion, THREAD_QUOTE_SCHEMA_VERSION)
assert.equal(origin.kind, "branch-origin")
assert.equal(origin.text, origin.source.anchor.quote.exact)

const parsed = parseThreadQuoteData(origin)
assert.equal(parsed.schemaVersion, THREAD_QUOTE_SCHEMA_VERSION)
assert.equal(parsed.source.threadId, parentThreadId)
assert.deepEqual(parseThreadQuoteData({ text: "legacy" }), {
  schemaVersion: "legacy",
  quoteId: null,
  kind: "legacy",
  text: "legacy",
  source: null,
})
assert.throws(() =>
  parseThreadQuoteData({
    ...origin,
    text: "不匹配",
  })
)

const serialized = threadQuotePartToModelText(origin)
assert.match(serialized, new RegExp(THREAD_QUOTE_MODEL_FORMAT_VERSION))
assert.match(serialized, /相同前缀/)
assert.doesNotMatch(serialized, new RegExp(origin.quoteId))
assert.doesNotMatch(serialized, new RegExp(parentThreadId))
const delimiterText = quoteContentToModelText({
  text: '代码：\n```ts\nconst x = "</thread_quote>"\n```',
  comment: "逐行解释",
})
assert.match(delimiterText, /\\n/)
assert.match(delimiterText, /逐行解释/)

const selection = {
  source: {
    type: "message-selection",
    sourceMessageId,
    anchor: anchor(),
  },
  comment: "解释",
}
assert.equal(quoteSelectionKey(selection), quoteSelectionKey(selection))

const validSend = {
  commandId: id(),
  userMessageId: id(),
  assistantMessageId: id(),
  modelId: "test/model",
  text: "",
  files: [],
  quotes: [selection],
}
assert.equal(sendMessageCommandSchema.parse(validSend).quotes.length, 1)
assert.throws(() =>
  sendMessageCommandSchema.parse({
    ...validSend,
    quotes: Array.from({ length: THREAD_QUOTE_MAX_COUNT + 1 }, (_, index) => ({
      source: {
        type: "message-selection",
        sourceMessageId: id(),
        anchor: anchor(`quote-${index}`),
      },
      comment: "x",
    })),
  })
)
assert.throws(() =>
  sendMessageCommandSchema.parse({
    ...validSend,
    quotes: [
      {
        source: {
          type: "message-selection",
          sourceMessageId,
          sourceThreadId: id(),
          anchor: anchor(),
        },
        comment: "x",
      },
    ],
  })
)
assert.throws(() =>
  sendMessageCommandSchema.parse({ ...validSend, quotes: [], text: "" })
)

const validFork = {
  commandId: id(),
  threadId: id(),
  sourceMessageId,
  anchorText: "相同前缀",
  anchor: anchor(),
  modelId: "test/model",
}
assert.equal(forkThreadCommandSchema.parse(validFork).firstTurn, undefined)

const userParts = buildUserParts({
  text: "为什么？",
  files: [],
  quotes: [origin],
})
assert.deepEqual(userParts.map((part) => part.type), ["data-quote", "text"])
const editedParts = replaceUserEditableParts({
  sourceParts: userParts,
  text: "请举例",
  files: [],
})
assert.deepEqual(editedParts.map((part) => part.type), ["data-quote", "text"])
assert.deepEqual(editedParts[0], userParts[0])

assert.equal(assertQuoteBudget([origin]).quoteCount, 1)
assert.throws(() =>
  assertPromptWindowBudget({ inputCharacters: 10_000_000, contextWindowTokens: 1000 })
)

const required = branchOriginDraftQuote({
  draftId: "origin",
  sourceMessageId,
  anchor: anchor(),
  previewText: "相同前缀",
})
const normal = {
  draftId: "normal",
  origin: "manual-selection",
  source: {
    type: "message-selection",
    sourceMessageId: id(),
    anchor: anchor("第二段"),
  },
  previewText: "第二段",
  comment: "比较",
  required: false,
}
let draft = addComposerQuote(emptyThreadComposerDraft(), normal)
draft = addComposerQuote(draft, required)
assert.equal(draft.quotes[0].required, true)
assert.equal(isComposerDraftSendable(draft), true)
const submission = composerDraftToSubmission(draft)
assert.equal(submission.quotes.length, 1, "required origin 由服务端生成")
assert.equal(submission.quotes[0].comment, "比较")
assert.throws(() => removeComposerQuote(draft, "origin"))
assert.equal(moveComposerQuote(draft, "normal", 0).quotes[0].draftId, "origin")

assert.equal(
  selectGenerationToolProfile({
    artifactRequested: true,
    researchMode: "research",
    searchReady: true,
  }),
  "thread-web-artifact-v1"
)
assert.deepEqual(generationToolProfile("thread-web-v1").toolNames, [
  "webSearch",
  "readUrl",
])
assert.equal(
  generationToolProfile("thread-web-v1").hash,
  generationToolProfile("thread-web-v1").hash
)

const affinityA = promptCacheAffinityKey({
  salt: "test-salt",
  userId: "user-a",
  projectId: "project-a",
  upstreamModelId: "claude",
})
const affinitySibling = promptCacheAffinityKey({
  salt: "test-salt",
  userId: "user-a",
  projectId: "project-a",
  upstreamModelId: "claude",
})
const affinityOtherProject = promptCacheAffinityKey({
  salt: "test-salt",
  userId: "user-a",
  projectId: "project-b",
  upstreamModelId: "claude",
})
assert.equal(affinityA, affinitySibling)
assert.notEqual(affinityA, affinityOtherProject)

const fakeResolved = {
  route: { upstreamModelId: "claude" },
  cache: {
    strategy: "probe-required",
    supportsAffinity: true,
  },
}
assert.deepEqual(
  buildPromptCacheControls({
    resolved: fakeResolved,
    userId: "u",
    projectId: "p",
    mode: "enabled",
    affinitySalt: "salt",
  }),
  {
    mode: "enabled",
    enabled: false,
    reason: "probe-required",
  }
)

const sharedSystem = "kernel"
const inherited = [{ role: "user", content: "A" }]
const siblingA = stablePrefixHash({
  toolProfileId: "thread-answer-v1",
  toolProfileHash: "tools",
  system: sharedSystem,
  inheritedMessages: inherited,
  branchHistoryMessages: [],
})
const siblingB = stablePrefixHash({
  toolProfileId: "thread-answer-v1",
  toolProfileHash: "tools",
  system: sharedSystem,
  inheritedMessages: inherited,
  branchHistoryMessages: [],
})
assert.equal(siblingA, siblingB)
assert.notEqual(
  siblingA,
  canonicalHash({ sharedSystem, inherited, changedToolProfile: true })
)

const merged = mergeBranchOriginQuote(origin, [origin])
assert.equal(merged.length, 1)

console.log("PASS prompt cache and quote contracts")
