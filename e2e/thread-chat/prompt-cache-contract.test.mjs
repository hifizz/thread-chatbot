import assert from "node:assert/strict"
import {
  legacyThreadQuotePartSchema,
  quoteForModel,
  threadQuotePartV1Schema,
} from "../../lib/thread-chat/contracts/quote.ts"
import {
  composerDraftToMessageContent,
  messageContentToUiParts,
} from "../../lib/thread-chat/contracts/message-content.ts"
import {
  sendMessageCommandSchema,
  editLatestTurnCommandSchema,
  forkThreadCommandSchema,
  startProjectCommandSchema,
} from "../../lib/thread-chat/contracts/commands.ts"
import { resolveGenerationMode } from "../../lib/thread-chat/streaming/generation-modes.ts"
import { resolvePromptCachePolicy } from "../../lib/thread-chat/streaming/prompt-cache-policy.ts"
import { decoratePromptCache } from "../../lib/thread-chat/streaming/prompt-cache-decorator.ts"
import { buildPromptCacheObservation } from "../../lib/thread-chat/streaming/prompt-cache-observation.ts"
import { aggregatePromptCacheObservations } from "../../lib/thread-chat/streaming/prompt-cache-metrics.ts"
import { THREAD_CHAT_PROMPT_SCHEMA_VERSION } from "../../constants/thread-chat-prompt.ts"

const ids = {
  command: "10000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000002",
  assistant: "10000000-0000-4000-8000-000000000003",
  source: "10000000-0000-4000-8000-000000000004",
}
const quote = {
  schemaVersion: "thread-quote-v1",
  text: "selected text",
  comment: "explain",
  source: {
    type: "message",
    messageId: ids.source,
    anchor: {
      quote: { exact: "selected text", prefix: "before", suffix: "after" },
      position: { start: 10, end: 23 },
    },
  },
}
const persisted = { type: "data-quote", data: quote }
assert.equal(threadQuotePartV1Schema.safeParse(persisted).success, true)
assert.equal(
  threadQuotePartV1Schema.safeParse({
    ...persisted,
    data: { ...quote, text: "changed" },
  }).success,
  false
)
assert.equal(
  legacyThreadQuotePartSchema.safeParse({
    type: "data-quote",
    data: { text: "legacy" },
  }).success,
  true
)
assert.deepEqual(quoteForModel(quote), {
  text: "selected text",
  comment: "explain",
})
assert.equal("source" in quoteForModel(quote), false)

const content = composerDraftToMessageContent({
  parts: [
    { localId: "1", type: "text", text: "question" },
    {
      localId: "2",
      type: "quote",
      quote: {
        text: quote.text,
        comment: quote.comment,
        source: quote.source,
        origin: "selection",
        readonlySnapshot: true,
      },
    },
    {
      localId: "3",
      type: "file",
      file: { url: "/api/attachments/a", mediaType: "text/plain" },
    },
    { localId: "4", type: "text", text: "follow-up" },
  ],
})
assert.deepEqual(
  content.parts.map((part) => part.type),
  ["text", "quote", "file", "text"]
)
assert.deepEqual(
  messageContentToUiParts(content).map((part) => part.type),
  ["text", "data-quote", "file", "text"]
)
assert.equal(
  sendMessageCommandSchema.safeParse({
    commandId: ids.command,
    userMessageId: ids.user,
    assistantMessageId: ids.assistant,
    modelId: "umapis-claude-sonnet-5",
    parts: content.parts,
  }).success,
  true
)
assert.equal(
  sendMessageCommandSchema.safeParse({
    commandId: ids.command,
    userMessageId: ids.user,
    assistantMessageId: ids.assistant,
    modelId: "model",
    parts: [{ type: "quote", quote }],
  }).success,
  false,
  "Quote 不能代替总体问题"
)

const seenModes = new Set()
const generationSettings = { effort: "high", maxOutputTokens: 32_000 }
const imageFile = {
  url: `/api/attachments/${ids.source}`,
  mediaType: "image/png",
  filename: "reference.png",
}
const mixedParts = [
  { type: "quote", quote },
  { type: "file", file: imageFile },
  { type: "text", text: "解释引用并对照图片" },
]
const turn = {
  commandId: ids.command,
  userMessageId: ids.user,
  assistantMessageId: ids.assistant,
  modelId: "iceland-claude-opus-5",
  generationSettings,
  parts: mixedParts,
}
for (const schema of [sendMessageCommandSchema, editLatestTurnCommandSchema]) {
  const parsed = schema.parse(turn)
  assert.deepEqual(parsed.generationSettings, generationSettings)
  assert.deepEqual(messageContentToUiParts(parsed), [
    { type: "data-quote", data: quote },
    { type: "file", ...imageFile },
    { type: "text", text: "解释引用并对照图片" },
  ])
  assert.equal(
    schema.safeParse({
      ...turn,
      generationSettings: { ...generationSettings, maxOutputTokens: 12345 },
    }).success,
    false
  )
}
assert.deepEqual(
  startProjectCommandSchema.parse({
    ...turn,
    projectId: ids.source,
    rootThreadId: ids.command,
    parts: mixedParts.slice(1),
  }).generationSettings,
  generationSettings
)
const fork = forkThreadCommandSchema.parse({
  commandId: ids.command,
  threadId: ids.command,
  sourceMessageId: ids.source,
  anchorText: quote.text,
  anchor: quote.source.anchor,
  modelId: turn.modelId,
  generationSettings,
  firstTurn: {
    userMessageId: ids.user,
    assistantMessageId: ids.assistant,
    parts: mixedParts,
  },
})
assert.deepEqual(fork.generationSettings, generationSettings)
assert.deepEqual(fork.firstTurn.parts, mixedParts)

for (const researchMode of ["answer", "fetch", "search", "research"]) {
  for (const artifactRequested of [false, true]) {
    const mode = resolveGenerationMode({
      researchMode,
      artifactRequested,
    })
    seenModes.add(mode.id)
    assert.equal(mode.artifactRequested, artifactRequested)
    assert.equal(mode.researchMode, researchMode)
    assert.ok(mode.maxSteps > 0)
    assert.equal("maxOutputTokens" in mode, false)
    assert.equal("reasoning" in mode, false)
    if (artifactRequested)
      assert.equal(mode.toolNames[0], "createMarkdownArtifact")
  }
}
assert.equal(seenModes.size, 8)
assert.equal(THREAD_CHAT_PROMPT_SCHEMA_VERSION, "thread-chat-prompt-v1")

const eligibleRoute = {
  actualProvider: "umapis",
  protocol: "anthropic",
  credentialGroup: "claude",
  upstreamModel: "claude-sonnet-5",
}
for (const upstreamModel of ["claude-sonnet-5", "claude-opus-5"]) {
  assert.equal(
    resolvePromptCachePolicy({ ...eligibleRoute, upstreamModel })
      .explicitCacheEnabled,
    true
  )
}
for (const route of [
  { ...eligibleRoute, upstreamModel: "claude-opus-4-7" },
  { ...eligibleRoute, actualProvider: "openrouter", protocol: "openrouter" },
  { ...eligibleRoute, credentialGroup: "gpt", protocol: "openai-compatible" },
  {
    ...eligibleRoute,
    actualProvider: "private-relay",
    protocol: "openai-compatible",
  },
]) {
  assert.equal(resolvePromptCachePolicy(route).explicitCacheEnabled, false)
}

const messages = [
  { role: "user", content: "history" },
  { role: "assistant", content: [{ type: "text", text: "answer" }] },
  { role: "user", content: "current" },
]
const decorated = decoratePromptCache({
  instructions: [{ role: "system", content: "stable system" }],
  messages,
  boundaries: { stableInstructionsEnd: true, stableHistoryMessageIndex: 1 },
  policy: resolvePromptCachePolicy(eligibleRoute),
})
assert.equal(decorated.breakpointCount, 2)
assert.equal(decorated.messages[2].providerOptions, undefined)
const stripProviderOptions = (value) => {
  if (Array.isArray(value)) return value.map(stripProviderOptions)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "providerOptions")
      .map(([key, item]) => [key, stripProviderOptions(item)])
  )
}
assert.equal(decorated.instructions[0].content, "stable system")
assert.deepEqual(stripProviderOptions(decorated.messages), messages)
const undecorated = decoratePromptCache({
  instructions: [{ role: "system", content: "stable system" }],
  messages,
  boundaries: { stableInstructionsEnd: true, stableHistoryMessageIndex: 1 },
  policy: { explicitCacheEnabled: false },
})
assert.deepEqual(undecorated.instructions, [
  { role: "system", content: "stable system" },
])
assert.deepEqual(undecorated.messages, messages)

const context = {
  route: eligibleRoute,
  generationMode: "answer",
  promptSchemaVersion: THREAD_CHAT_PROMPT_SCHEMA_VERSION,
  projectContractVersion: 3,
  explicitCacheEnabled: true,
}
const usage = (details) => ({
  inputTokens: details.inputTokens,
  inputTokenDetails: {
    noCacheTokens: details.noCacheTokens,
    cacheReadTokens: details.cacheReadTokens,
    cacheWriteTokens: details.cacheWriteTokens,
  },
  outputTokens: details.outputTokens,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: undefined,
})
const hit = buildPromptCacheObservation(
  usage({
    inputTokens: 100,
    noCacheTokens: 20,
    cacheReadTokens: 70,
    cacheWriteTokens: 10,
    outputTokens: 5,
  }),
  context
)
assert.equal(hit.status, "hit")
assert.equal(hit.metricFormula, "detailed-input")
assert.equal(hit.tokenHitRate, 0.7)
const miss = buildPromptCacheObservation(
  usage({
    inputTokens: 100,
    noCacheTokens: 90,
    cacheReadTokens: 0,
    cacheWriteTokens: 10,
    outputTokens: 5,
  }),
  context
)
assert.equal(miss.status, "miss")
assert.equal(miss.cacheReadTokens, 0)
const unknown = buildPromptCacheObservation(
  usage({ inputTokens: 100, outputTokens: 5 }),
  context
)
assert.equal(unknown.status, "unknown")
assert.equal("cacheReadTokens" in unknown, false)
const fallback = buildPromptCacheObservation(
  usage({ inputTokens: 100, cacheReadTokens: 25, outputTokens: 5 }),
  context
)
assert.equal(fallback.metricFormula, "input-total")
assert.equal(fallback.tokenHitRate, 0.25)

const aggregates = aggregatePromptCacheObservations([hit, miss, unknown])
assert.equal(aggregates.length, 1)
assert.equal(aggregates[0].knownRequestCount, 2)
assert.equal(aggregates[0].requestHitRate, 0.5)
assert.equal(aggregates[0].unknownRate, 1 / 3)
assert.equal(aggregates[0].metricFormula, "unavailable")

console.log("PASS thread chat prompt cache contracts")
