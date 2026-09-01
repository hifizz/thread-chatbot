import assert from "node:assert/strict"
import test from "node:test"

import { finalizeGenerationPrompt } from "../../lib/thread-chat/application/finalize-generation-prompt.ts"
import {
  quoteContentToModelText,
  threadQuotePartToModelText,
} from "../../lib/thread-chat/application/quote-model.ts"
import {
  assertPromptInputBudget,
} from "../../lib/thread-chat/prompt-cache/input-budget.ts"
import {
  buildPromptCacheProviderControls,
  promptCacheAffinityKey,
} from "../../lib/thread-chat/prompt-cache/provider-controls.ts"
import {
  resolveGenerationToolProfile,
} from "../../lib/thread-chat/streaming/generation-tool-profile.ts"

const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  parentThread: "22222222-2222-4222-8222-222222222222",
  message: "33333333-3333-4333-8333-333333333333",
  quote: "44444444-4444-4444-8444-444444444444",
  quote2: "55555555-5555-4555-8555-555555555555",
}

const anchor = {
  quote: { exact: "selected text", prefix: "before", suffix: "after" },
  position: { start: 7, end: 20 },
}

function quoteData({
  quoteId = ids.quote,
  threadId = ids.parentThread,
  messageId = ids.message,
  text = anchor.quote.exact,
} = {}) {
  return {
    schemaVersion: "thread-quote-v1",
    quoteId,
    kind: "branch-origin",
    text,
    source: {
      type: "message-selection",
      projectId: ids.project,
      threadId,
      messageId,
      anchor: {
        ...anchor,
        quote: { ...anchor.quote, exact: text },
      },
    },
  }
}

function userUiMessage(quote, question) {
  return {
    id: "user",
    role: "user",
    metadata: { messageId: "user", threadId: "child" },
    parts: [
      { type: "data-quote", data: quote },
      { type: "text", text: question },
    ],
  }
}

function promptBase(quote, question) {
  return {
    inheritedMessages: [
      { role: "user", content: "parent question" },
      { role: "assistant", content: "parent answer" },
    ],
    branchHistoryMessages: [],
    currentUserMessages: [
      {
        role: "user",
        content: [
          { type: "text", text: threadQuotePartToModelText(quote) },
          { type: "text", text: question },
        ],
      },
    ],
    currentUserUiMessage: userUiMessage(quote, question),
    forkContextHash: "fork-hash",
    inheritedCharacters: 100,
    branchHistoryCharacters: 0,
  }
}

function resolved(overrides = {}) {
  return {
    model: {},
    route: {
      appModelId: "test-model",
      adapter: "openrouter",
      gateway: "openrouter",
      upstreamModelId: "anthropic/test",
      routeId: "openrouter:anthropic/test",
      routingPolicyVersion: "route-v1",
    },
    cache: {
      strategy: "implicit",
      profileVersion: "cache-v1",
      supportsAffinity: true,
      supportsCacheReadUsage: true,
      supportsCacheWriteUsage: true,
      supportedTtls: ["provider-default"],
      retentionClass: "ephemeral-memory",
    },
    ...overrides,
  }
}

function compile(base, route = resolved()) {
  const profile = resolveGenerationToolProfile({
    artifactRequested: false,
    researchMode: "answer",
    searchReady: false,
  })
  return finalizeGenerationPrompt({
    base,
    resolved: route,
    userId: "user-1",
    projectId: ids.project,
    tools: {},
    toolProfile: profile,
    runtimeControl: { researchMode: "answer" },
  })
}

test("sibling branches keep the same stable prefix until their B1 quote", () => {
  const left = compile(promptBase(quoteData(), "why?"))
  const right = compile(
    promptBase(
      quoteData({
        quoteId: ids.quote2,
        text: "another selection",
      }),
      "compare"
    )
  )

  assert.equal(
    left.manifest.stableRequestPrefixHash,
    right.manifest.stableRequestPrefixHash
  )
  assert.equal(left.manifest.forkContextHash, right.manifest.forkContextHash)
  assert.notDeepEqual(left.messages.at(-1), right.messages.at(-1))
  assert.equal(left.manifest.currentUserQuoteCount, 1)
  assert.equal(right.manifest.currentUserQuoteCount, 1)
})

test("branch history extends the stable prefix without moving current runtime data", () => {
  const base = promptBase(quoteData(), "next")
  base.branchHistoryMessages = [
    {
      role: "user",
      content: quoteContentToModelText({ text: "old quote" }),
    },
    { role: "assistant", content: "old answer" },
  ]
  const compiled = compile(base)
  const kinds = compiled.manifest.segments.map((segment) => segment.kind)
  assert.deepEqual(kinds, [
    "agent-kernel",
    "project-contract",
    "inherited-history",
    "branch-history",
    "runtime-control",
    "current-user",
  ])
  assert.equal(compiled.messages.at(-2).role, "user")
  assert.match(String(compiled.messages.at(-2).content), /runtime_control/)
})

test("quote navigation metadata never enters model text", () => {
  const first = threadQuotePartToModelText(quoteData())
  const second = threadQuotePartToModelText(
    quoteData({
      quoteId: ids.quote2,
      threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    })
  )
  assert.equal(first, second)
  assert.doesNotMatch(first, /11111111|22222222|33333333|position|quoteId/)
})

test("tool profiles form explicit stable partitions", () => {
  const answer = resolveGenerationToolProfile({
    artifactRequested: false,
    researchMode: "answer",
    searchReady: true,
  })
  const web = resolveGenerationToolProfile({
    artifactRequested: false,
    researchMode: "research",
    searchReady: true,
  })
  const webAgain = resolveGenerationToolProfile({
    artifactRequested: false,
    researchMode: "search",
    searchReady: true,
  })
  assert.notEqual(answer.hash, web.hash)
  assert.equal(web.hash, webAgain.hash)
  assert.deepEqual(web.orderedToolNames, ["webSearch", "readUrl"])
})

test("affinity keys are stable within project/model and isolated across scopes", () => {
  const common = {
    salt: "secret-salt",
    userId: "user-1",
    projectId: ids.project,
    upstreamModelId: "anthropic/test",
    cacheProfileVersion: "cache-v1",
  }
  const first = promptCacheAffinityKey(common)
  assert.equal(first, promptCacheAffinityKey(common))
  assert.notEqual(
    first,
    promptCacheAffinityKey({ ...common, projectId: "other-project" })
  )
  assert.notEqual(
    first,
    promptCacheAffinityKey({ ...common, upstreamModelId: "other-model" })
  )
  assert.doesNotMatch(first, /user-1|11111111|anthropic/)
})

test("provider controls are route-scoped and observe mode never sends controls", () => {
  const observe = buildPromptCacheProviderControls({
    resolved: resolved(),
    rolloutMode: "observe",
    userId: "user-1",
    projectId: ids.project,
    affinitySalt: "secret",
  })
  assert.equal(observe.applied, "none")
  assert.equal(observe.headers, undefined)

  const enabled = buildPromptCacheProviderControls({
    resolved: resolved(),
    rolloutMode: "enabled",
    userId: "user-1",
    projectId: ids.project,
    affinitySalt: "secret",
  })
  assert.equal(enabled.applied, "implicit")
  assert.ok(enabled.headers?.["x-session-id"])

  const probe = buildPromptCacheProviderControls({
    resolved: resolved({
      cache: {
        ...resolved().cache,
        strategy: "probe-required",
      },
    }),
    rolloutMode: "enabled",
    userId: "user-1",
    projectId: ids.project,
    affinitySalt: "secret",
  })
  assert.equal(probe.applied, "none")
  assert.equal(probe.reason, "probe-required")
})

test("input budget fails before a provider call", () => {
  assert.doesNotThrow(() =>
    assertPromptInputBudget({
      characters: 3_000,
      policy: {
        version: "thread-quote-budget-v1",
        maxInputTokens: 4_000,
        reservedOutputTokens: 1_000,
      },
    })
  )
  assert.throws(
    () =>
      assertPromptInputBudget({
        characters: 20_000,
        policy: {
          version: "thread-quote-budget-v1",
          maxInputTokens: 4_000,
          reservedOutputTokens: 1_000,
        },
      }),
    /INPUT_BUDGET_EXCEEDED|安全输入预算/
  )
})
