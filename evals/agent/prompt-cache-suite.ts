import {
  THREAD_AGENT_KERNEL_VERSION,
  THREAD_PROMPT_CACHE_PROFILE_VERSION,
  THREAD_PROMPT_COMPILER_VERSION,
  THREAD_PROVIDER_ROUTING_POLICY_VERSION,
  THREAD_QUOTE_BUDGET_POLICY_VERSION,
  THREAD_QUOTE_MODEL_FORMAT_VERSION,
  THREAD_QUOTE_SCHEMA_VERSION,
  THREAD_TOOL_PROFILE_VERSION,
} from "@/constants/thread-chat"
import { executeFixtureCase } from "@/evals/agent/executors/fixture"
import type { EvaluationCandidateConfig } from "@/evals/agent/fingerprint"
import { runAgentEvaluation } from "@/evals/agent/runner"
import { parseAgentCase, type AgentCase } from "@/evals/agent/schema"
import { promptCacheScorer } from "@/evals/agent/scorers/cache"

const PREFIX = "a".repeat(64)
const ROUTE = "anthropic:umapis:claude-fake"
const PROFILE = "thread-answer-v1"

function fixtureCase(input: {
  id: string
  quoteCount: number
  cacheOutcome:
    | "provider-hit"
    | "provider-miss"
    | "usage-unavailable"
    | "cold-start"
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
}): AgentCase {
  return parseAgentCase({
    schemaVersion: "agent-case-v1",
    id: input.id,
    suite: "prompt-cache",
    tags: ["prompt-cache", `quotes-${input.quoteCount}`],
    sensitivity: "synthetic",
    execution: "fixture",
    input: {
      messages: [
        {
          role: "user",
          text: `Synthetic prompt-cache fixture with ${input.quoteCount} quotes`,
        },
      ],
      attachments: [],
    },
    expected: {
      terminalState: "completed",
      cacheEligible: true,
      cacheOutcome: input.cacheOutcome,
      prefixHash: PREFIX,
      quoteCount: input.quoteCount,
      metadataExcluded: true,
    },
    fixtureResult: {
      text: "fixture completed",
      tools: [],
      terminalState: "completed",
      providerAttempts: [],
      modelAttempts: [
        {
          stepIndex: 0,
          routeId: ROUTE,
          toolProfileId: PROFILE,
          stableRequestPrefixHash: PREFIX,
          cacheOutcome: input.cacheOutcome,
          inputTokens: 12_000,
          ...(input.cacheReadTokens !== undefined
            ? { cacheReadTokens: input.cacheReadTokens }
            : {}),
          ...(input.cacheWriteTokens !== undefined
            ? { cacheWriteTokens: input.cacheWriteTokens }
            : {}),
          ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
        },
      ],
      cache: {
        eligible: true,
        reason: "eligible",
        requestPrefixHash: PREFIX,
        toolProfileId: PROFILE,
        routeId: ROUTE,
        inputTokens: 12_000,
        ...(input.cacheReadTokens !== undefined
          ? { cacheReadTokens: input.cacheReadTokens }
          : {}),
        ...(input.cacheWriteTokens !== undefined
          ? { cacheWriteTokens: input.cacheWriteTokens }
          : {}),
        ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
        quoteCount: input.quoteCount,
        metadataExcluded: true,
      },
    },
  })
}

export const PROMPT_CACHE_FIXTURE_CASES: readonly AgentCase[] = [
  fixtureCase({
    id: "prompt-cache-zero-quotes",
    quoteCount: 0,
    cacheOutcome: "provider-miss",
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.2,
  }),
  fixtureCase({
    id: "prompt-cache-one-quote-hit",
    quoteCount: 1,
    cacheOutcome: "provider-hit",
    cacheReadTokens: 11_000,
    cacheWriteTokens: 0,
    costUsd: 0.09,
  }),
  fixtureCase({
    id: "prompt-cache-two-quotes-order",
    quoteCount: 2,
    cacheOutcome: "provider-hit",
    cacheReadTokens: 10_500,
    cacheWriteTokens: 0,
    costUsd: 0.1,
  }),
  fixtureCase({
    id: "prompt-cache-fifty-quotes-budgeted",
    quoteCount: 50,
    cacheOutcome: "provider-hit",
    cacheReadTokens: 9_000,
    cacheWriteTokens: 0,
    costUsd: 0.12,
  }),
  fixtureCase({
    id: "prompt-cache-usage-unavailable",
    quoteCount: 1,
    cacheOutcome: "usage-unavailable",
  }),
]

export const PROMPT_CACHE_EVAL_CANDIDATE: EvaluationCandidateConfig = {
  candidate: "prompt-cache-fake-v1",
  model: "fake-umapis-claude",
  promptVersion: "thread-chat-prompt-v2",
  searchPolicyVersion: "anysearch-v1",
  searchProvider: "fixture",
  memoryPolicyVersion: "thread-context-v1",
  contextPolicy: "prompt-cache-fixture-v1",
  toolsetVersion: "thread-chat-tools-v2",
  multimodalParserVersion: "attachment-parser-v1",
  promptCompilerVersion: THREAD_PROMPT_COMPILER_VERSION,
  agentKernelVersion: THREAD_AGENT_KERNEL_VERSION,
  quoteProtocolVersion: THREAD_QUOTE_SCHEMA_VERSION,
  quoteModelFormatVersion: THREAD_QUOTE_MODEL_FORMAT_VERSION,
  quoteBudgetPolicyVersion: THREAD_QUOTE_BUDGET_POLICY_VERSION,
  promptCacheProfileVersion: THREAD_PROMPT_CACHE_PROFILE_VERSION,
  promptCacheMode: "enabled",
  toolProfilePolicy: THREAD_TOOL_PROFILE_VERSION,
  providerRoutePolicy: "fake-umapis-claude-v1",
  providerRoutingPolicyVersion: THREAD_PROVIDER_ROUTING_POLICY_VERSION,
  release: "test",
  commit: "fixture",
  environment: "evaluation",
  evaluatorVersion: "prompt-cache-scorer-v1",
}

export function runPromptCacheFixtureEvaluation() {
  return runAgentEvaluation(PROMPT_CACHE_FIXTURE_CASES, {
    runId: "prompt-cache-fixture-run",
    mode: "ci",
    candidate: PROMPT_CACHE_EVAL_CANDIDATE,
    selection: {
      caseIds: PROMPT_CACHE_FIXTURE_CASES.map((item) => item.id),
    },
    executor: ({ evaluationCase }) => executeFixtureCase(evaluationCase),
    scorers: [promptCacheScorer],
  })
}
