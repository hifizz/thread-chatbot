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
  executeWithPromptCacheFallback,
  promptCacheAffinityKey,
  selectPromptCacheBreakpoints,
} from "../../lib/ai/prompt-cache.ts"
import {
  canonicalHash,
  stablePrefixHash,
} from "../../lib/thread-chat/application/prompt-cache.ts"
import {
  aggregatePromptCacheUsage,
  normalizePromptCacheUsage,
} from "../../lib/ai/prompt-cache-usage.ts"
import {
  createModelAttemptCollector,
} from "../../lib/ai/model-attempt.ts"
import {
  evaluatePromptCacheProbe,
  fakeClaudeCacheProbe,
  DEFAULT_FAKE_CLAUDE_PRICE_CARD,
} from "../../lib/ai/prompt-cache-probe.ts"
import {
  compiledSegmentCacheKey,
  InMemoryCompiledSegmentCache,
  NoopCompiledSegmentCache,
} from "../../lib/thread-chat/application/compiled-segment-cache.ts"

const id = () => crypto.randomUUID()
const anchor = (exact = "相同前缀", index = 4) => ({
  quote: { exact, prefix: "缓存需要", suffix: "才能复用" },
  position: { start: index, end: index + exact.length },
})
const sourceMessageId = id()
const projectId = id()
const parentThreadId = id()

function selection(exact, comment = "解释", index = 4) {
  return {
    source: {
      type: "message-selection",
      sourceMessageId: id(),
      anchor: anchor(exact, index),
    },
    ...(comment ? { comment } : {}),
  }
}

function versionedQuote(exact, index = 0) {
  return buildBranchOriginQuote({
    projectId,
    parentThreadId,
    sourceMessageId: id(),
    anchor: anchor(exact, index),
    anchorText: exact,
    quoteId: id(),
  })
}

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
assert.throws(() =>
  parseThreadQuoteData({
    ...origin,
    schemaVersion: "thread-quote-v999",
  })
)

const serialized = threadQuotePartToModelText(origin)
assert.match(serialized, new RegExp(THREAD_QUOTE_MODEL_FORMAT_VERSION))
assert.match(serialized, /相同前缀/)
assert.doesNotMatch(serialized, new RegExp(origin.quoteId))
assert.doesNotMatch(serialized, new RegExp(parentThreadId))
const sameTextDifferentMetadata = {
  ...origin,
  quoteId: id(),
  source: { ...origin.source, projectId: id(), threadId: id(), messageId: id() },
}
assert.equal(
  threadQuotePartToModelText(origin),
  threadQuotePartToModelText(sameTextDifferentMetadata),
  "导航元信息不能改变模型文本"
)
const delimiterText = quoteContentToModelText({
  text: '代码：\n```ts\nconst x = "</thread_quote>"\n```',
  comment: "逐行解释",
})
assert.match(delimiterText, /\\n/)
assert.match(delimiterText, /逐行解释/)

const oneSelection = {
  source: {
    type: "message-selection",
    sourceMessageId,
    anchor: anchor(),
  },
  comment: "解释",
}
assert.equal(quoteSelectionKey(oneSelection), quoteSelectionKey(oneSelection))

const validSend = {
  commandId: id(),
  userMessageId: id(),
  assistantMessageId: id(),
  modelId: "test/model",
  text: "",
  files: [],
  quotes: [oneSelection],
}
assert.equal(sendMessageCommandSchema.parse(validSend).quotes.length, 1)
const fiftySelections = Array.from({ length: THREAD_QUOTE_MAX_COUNT }, (_, index) =>
  selection(`quote-${index}`, "x", index * 20)
)
assert.equal(
  sendMessageCommandSchema.parse({ ...validSend, quotes: fiftySelections }).quotes
    .length,
  THREAD_QUOTE_MAX_COUNT
)
assert.throws(() =>
  sendMessageCommandSchema.parse({
    ...validSend,
    quotes: [...fiftySelections, selection("too-many")],
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

assert.deepEqual(
  buildUserParts({ text: "普通问题", files: [], quotes: [] }).map(
    (part) => part.type
  ),
  ["text"]
)
const userParts = buildUserParts({
  text: "为什么？",
  files: [],
  quotes: [origin],
})
assert.deepEqual(userParts.map((part) => part.type), ["data-quote", "text"])
const twoQuoteParts = buildUserParts({
  text: "比较",
  files: [],
  quotes: [origin, versionedQuote("第二段", 50)],
})
assert.deepEqual(twoQuoteParts.map((part) => part.type), [
  "data-quote",
  "data-quote",
  "text",
])
const fiftyQuoteParts = buildUserParts({
  text: "逐条处理",
  files: [],
  quotes: Array.from({ length: THREAD_QUOTE_MAX_COUNT }, (_, index) =>
    versionedQuote(`短引用-${index}`, index * 20)
  ),
})
assert.equal(
  fiftyQuoteParts.filter((part) => part.type === "data-quote").length,
  THREAD_QUOTE_MAX_COUNT
)
const editedParts = replaceUserEditableParts({
  sourceParts: userParts,
  text: "请举例",
  files: [],
})
assert.deepEqual(editedParts.map((part) => part.type), ["data-quote", "text"])
assert.deepEqual(editedParts[0], userParts[0])

assert.equal(assertQuoteBudget([origin]).quoteCount, 1)
assert.throws(() =>
  assertPromptWindowBudget({
    inputCharacters: 10_000_000,
    contextWindowTokens: 1000,
  })
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
  isComposerDraftSendable({ text: "", quotes: [{ ...normal, comment: "" }], files: [] }),
  false
)

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
assert.notEqual(
  generationToolProfile("thread-web-v1").hash,
  generationToolProfile("thread-answer-v1").hash
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
assert.equal(
  buildPromptCacheControls({
    resolved: fakeResolved,
    userId: "u",
    projectId: "p",
    mode: "observe",
  }).reason,
  "observe-only"
)

assert.deepEqual(
  selectPromptCacheBreakpoints({
    candidates: [
      { kind: "kernel-end", tokenEstimate: 1200 },
      { kind: "inherited-end", tokenEstimate: 5000 },
      { kind: "branch-history-end", tokenEstimate: 6000 },
    ],
    minimumPrefixTokens: 1000,
    maximumBreakpoints: 2,
  }).map((item) => item.kind),
  ["inherited-end", "branch-history-end"]
)

let fallbackCalls = 0
const fallbackResult = await executeWithPromptCacheFallback({
  primary: { cache: true },
  fallback: { cache: false },
  execute: async (options) => {
    fallbackCalls += 1
    if (options.cache) throw new Error("cache_control invalid 400")
    return "ok"
  },
  isCacheControlRejection: (error) => /cache_control/.test(String(error)),
})
assert.deepEqual(fallbackResult, { result: "ok", usedFallback: true })
assert.equal(fallbackCalls, 2)

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

const standardUsage = normalizePromptCacheUsage({
  usage: {
    inputTokens: 1000,
    outputTokens: 100,
    inputTokenDetails: { cacheReadTokens: 700, cacheWriteTokens: 100 },
  },
})
assert.deepEqual(
  {
    read: standardUsage.cacheReadTokens,
    write: standardUsage.cacheWriteTokens,
    uncached: standardUsage.uncachedInputTokens,
  },
  { read: 700, write: 100, uncached: 200 }
)
const providerUsage = normalizePromptCacheUsage({
  providerMetadata: {
    anthropic: {
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 100,
        cost: 0.1,
      },
    },
  },
})
assert.equal(providerUsage.cacheReadTokens, 800)
assert.equal(providerUsage.costUsd, 0.1)
assert.equal(
  aggregatePromptCacheUsage([standardUsage, standardUsage]).cacheReadTokens,
  1400
)
assert.deepEqual(normalizePromptCacheUsage({}), {
  source: "unavailable",
  complete: false,
})

const collector = createModelAttemptCollector({
  purpose: "chat-answer",
  routeId: "anthropic:umapis:claude",
  upstreamModelId: "claude",
  adapter: "anthropic",
  gateway: "umapis",
  toolProfileId: "thread-answer-v1",
  stableRequestPrefixHash: siblingA,
  cacheStrategy: "explicit-breakpoint",
  cacheEligibility: "eligible",
})
collector.recordStep({
  finishReason: "stop",
  usage: {
    inputTokens: 1000,
    outputTokens: 100,
    inputTokenDetails: { cacheReadTokens: 700, cacheWriteTokens: 100 },
  },
})
assert.equal(collector.snapshot()[0].cacheOutcome, "provider-hit")
assert.equal(collector.summary().usage.cacheReadTokens, 700)

const fakeProbe = fakeClaudeCacheProbe()
assert.equal(fakeProbe.decision.enable, true)
assert.equal(fakeProbe.decision.reason, "lower-cost-no-regression")
const qualityRegression = evaluatePromptCacheProbe({
  baseline: fakeProbe.baseline,
  candidate: {
    ...fakeProbe.candidate,
    quality: { ...fakeProbe.candidate.quality, answerQuality: 0 },
  },
  price: DEFAULT_FAKE_CLAUDE_PRICE_CARD,
})
assert.deepEqual(qualityRegression, {
  enable: false,
  reason: "quality-regression",
})
const missingCost = evaluatePromptCacheProbe({
  baseline: { ...fakeProbe.baseline, usage: { source: "unavailable", complete: false } },
  candidate: fakeProbe.candidate,
  price: DEFAULT_FAKE_CLAUDE_PRICE_CARD,
})
assert.equal(missingCost.reason, "cost-not-proven")

const cacheKeyA = compiledSegmentCacheKey({
  tenantSalt: "salt",
  userId: "user-a",
  projectId: "project-a",
  promptCompilerVersion: "v1",
  segmentKind: "inherited-history",
  sourceContentHash: "hash",
  modelFamily: "claude",
  attachmentStrategyVersion: "v1",
})
const cacheKeyB = compiledSegmentCacheKey({
  tenantSalt: "salt",
  userId: "user-b",
  projectId: "project-a",
  promptCompilerVersion: "v1",
  segmentKind: "inherited-history",
  sourceContentHash: "hash",
  modelFamily: "claude",
  attachmentStrategyVersion: "v1",
})
assert.notEqual(cacheKeyA, cacheKeyB)
const l2 = new InMemoryCompiledSegmentCache(1)
await l2.set(
  cacheKeyA,
  {
    kind: "inherited-history",
    contentHash: "hash",
    modelMessages: [{ role: "user", content: "A" }],
    characters: 1,
    createdAt: new Date().toISOString(),
  },
  1000
)
assert.equal((await l2.get(cacheKeyA)).contentHash, "hash")
assert.equal(await l2.get(cacheKeyB), null)
assert.equal(await new NoopCompiledSegmentCache().get(cacheKeyA), null)

const merged = mergeBranchOriginQuote(origin, [origin])
assert.equal(merged.length, 1)

console.log("PASS prompt cache and quote contracts")
