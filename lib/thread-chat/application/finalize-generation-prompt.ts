import type { ModelMessage, SystemModelMessage, ToolSet } from "ai"
import {
  THREAD_CHAT_AGENT_KERNEL_VERSION,
  THREAD_CHAT_PROMPT_CACHE_PROFILE_VERSION,
  THREAD_CHAT_PROMPT_COMPILER_VERSION,
  THREAD_CHAT_PROVIDER_ROUTING_POLICY_VERSION,
  promptCacheRolloutMode,
} from "@/constants/thread-chat-prompt-cache"
import {
  THREAD_QUOTE_BUDGET_POLICY_VERSION,
  THREAD_QUOTE_MODEL_FORMAT_VERSION,
  THREAD_QUOTE_SCHEMA_VERSION,
} from "@/constants/thread-chat-quote"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import type {
  CompiledGenerationPrompt,
  PromptBase,
  PromptCacheBoundary,
  PromptManifest,
  PromptSegmentSummary,
  ResolvedChatModelRoute,
  RuntimePromptControl,
} from "@/lib/thread-chat/prompt-cache/types"
import {
  currentUserQuoteSummary,
  estimatePromptTokens,
  promptContentHash,
  promptVisibleCharacters,
} from "@/lib/thread-chat/prompt-cache/hash"
import { assertPromptInputBudget } from "@/lib/thread-chat/prompt-cache/input-budget"
import { buildPromptCacheProviderControls } from "@/lib/thread-chat/prompt-cache/provider-controls"
import type { GenerationToolProfile } from "@/lib/thread-chat/streaming/generation-tool-profile"

const RUNTIME_CONTROL_VERSION = "thread-chat-runtime-control-v1"

function runtimeControlMessage(input: {
  control: RuntimePromptControl
  policyTexts: readonly string[]
}): ModelMessage {
  const payload = {
    mode: input.control.researchMode,
    policies: input.policyTexts,
    ...(input.control.researchPlanText
      ? { plan: input.control.researchPlanText }
      : {}),
  }
  return {
    role: "user",
    content: [
      `<runtime_control format="${RUNTIME_CONTROL_VERSION}">`,
      JSON.stringify(payload),
      "</runtime_control>",
    ].join("\n"),
  }
}

function segmentSummary(
  kind: PromptSegmentSummary["kind"],
  scope: PromptSegmentSummary["scope"],
  stability: PromptSegmentSummary["stability"],
  value: unknown,
  messageCount: number
): PromptSegmentSummary {
  return {
    kind,
    scope,
    stability,
    contentHash: promptContentHash(value),
    characters: promptVisibleCharacters(value),
    messageCount,
  }
}

function boundary(
  kind: PromptCacheBoundary["kind"],
  value: unknown
): PromptCacheBoundary {
  const characters = promptVisibleCharacters(value)
  return {
    kind,
    prefixHash: promptContentHash(value),
    characters,
    tokenEstimate: estimatePromptTokens(characters),
  }
}

export function finalizeGenerationPrompt(input: {
  base: PromptBase
  resolved: ResolvedChatModelRoute
  userId: string
  projectId: string
  tools: ToolSet
  toolProfile: GenerationToolProfile
  runtimeControl: RuntimePromptControl
  runtimePolicyTexts?: readonly string[]
}): CompiledGenerationPrompt {
  const system: SystemModelMessage[] = [
    {
      role: "system",
      // Artifact policy is stable and explicitly conditional on the tool being
      // available, so tool profile changes do not rewrite the kernel text.
      content: buildThreadChatSystem(null, {
        enableMarkdownArtifact: true,
      }),
    },
  ]
  const runtime = runtimeControlMessage({
    control: input.runtimeControl,
    policyTexts: input.runtimePolicyTexts ?? [],
  })
  const messages: ModelMessage[] = [
    ...input.base.inheritedMessages,
    ...input.base.branchHistoryMessages,
    runtime,
    ...input.base.currentUserMessages,
  ]

  const toolDescriptor = {
    id: input.toolProfile.id,
    hash: input.toolProfile.hash,
    orderedToolNames: input.toolProfile.orderedToolNames,
  }
  const kernelPrefix = { tools: toolDescriptor, system }
  const inheritedPrefix = {
    ...kernelPrefix,
    inherited: input.base.inheritedMessages,
  }
  const branchPrefix = {
    ...inheritedPrefix,
    branchHistory: input.base.branchHistoryMessages,
  }
  const candidateBoundaries = [
    boundary("kernel-end", kernelPrefix),
    boundary("inherited-end", inheritedPrefix),
    boundary("branch-history-end", branchPrefix),
  ]
  const stableBoundary = candidateBoundaries[2]!
  const minimum = input.resolved.cache.minimumPrefixTokens ?? 0
  const cacheEligibility: PromptManifest["cacheEligibility"] =
    input.resolved.cache.strategy === "unsupported"
      ? { eligible: false, reason: "unsupported" }
      : input.resolved.cache.strategy === "probe-required"
        ? { eligible: false, reason: "probe-required" }
        : (stableBoundary.tokenEstimate ?? 0) < minimum
          ? { eligible: false, reason: "below-minimum" }
          : { eligible: true, reason: "eligible" }

  const quoteSummary = currentUserQuoteSummary(
    input.base.currentUserUiMessage
  )
  const segments: PromptSegmentSummary[] = [
    segmentSummary("agent-kernel", "global", "stable-prefix", system, system.length),
    segmentSummary(
      "project-contract",
      "project",
      "stable-prefix",
      [],
      0
    ),
    segmentSummary(
      "inherited-history",
      "fork-prefix",
      "stable-prefix",
      input.base.inheritedMessages,
      input.base.inheritedMessages.length
    ),
    segmentSummary(
      "branch-history",
      "thread-prefix",
      "stable-prefix",
      input.base.branchHistoryMessages,
      input.base.branchHistoryMessages.length
    ),
    segmentSummary(
      "runtime-control",
      "none",
      "dynamic-tail",
      runtime,
      1
    ),
    segmentSummary(
      "current-user",
      "none",
      "dynamic-tail",
      input.base.currentUserMessages,
      input.base.currentUserMessages.length
    ),
  ]

  const fullCharacters = promptVisibleCharacters({
    tools: toolDescriptor,
    system,
    messages,
  })
  assertPromptInputBudget({ characters: fullCharacters })

  const controls = buildPromptCacheProviderControls({
    resolved: input.resolved,
    rolloutMode: promptCacheRolloutMode(),
    userId: input.userId,
    projectId: input.projectId,
    ...(process.env.THREAD_CHAT_PROMPT_CACHE_AFFINITY_SALT
      ? {
          affinitySalt:
            process.env.THREAD_CHAT_PROMPT_CACHE_AFFINITY_SALT,
        }
      : {}),
  })

  const manifest: PromptManifest = {
    promptCompilerVersion: THREAD_CHAT_PROMPT_COMPILER_VERSION,
    agentKernelVersion: THREAD_CHAT_AGENT_KERNEL_VERSION,
    quoteProtocolVersion: THREAD_QUOTE_SCHEMA_VERSION,
    quoteModelFormatVersion: THREAD_QUOTE_MODEL_FORMAT_VERSION,
    quoteBudgetPolicyVersion: THREAD_QUOTE_BUDGET_POLICY_VERSION,
    promptCacheProfileVersion: THREAD_CHAT_PROMPT_CACHE_PROFILE_VERSION,
    providerRoutingPolicyVersion:
      THREAD_CHAT_PROVIDER_ROUTING_POLICY_VERSION,
    toolProfileId: input.toolProfile.id,
    toolProfileHash: input.toolProfile.hash,
    routeId: input.resolved.route.routeId,
    forkContextHash: input.base.forkContextHash,
    stableRequestPrefixHash: stableBoundary.prefixHash,
    stablePrefixCharacters: stableBoundary.characters,
    stablePrefixTokenEstimate: stableBoundary.tokenEstimate,
    currentUserQuoteCount: quoteSummary.count,
    currentUserQuoteCharacters: quoteSummary.characters,
    segments,
    candidateBoundaries,
    cacheEligibility,
  }

  return {
    system,
    messages,
    tools: input.tools,
    ...(controls.providerOptions
      ? { providerOptions: controls.providerOptions }
      : {}),
    ...(controls.headers ? { headers: controls.headers } : {}),
    manifest,
  }
}
