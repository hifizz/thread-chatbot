import {
  isStepCount,
  streamText,
  type LanguageModelUsage,
  type TextStreamPart,
  type ToolSet,
} from "ai"
import {
  DIRECT_FETCH_SYSTEM_PROMPT,
  RESEARCH_MAX_STEPS,
  RESEARCH_SYSTEM_PROMPT,
  WEB_ACCESS_SYSTEM_PROMPT,
} from "@/constants/research"
import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { getChatModel } from "@/constants/model"
import { isSearchConfigured } from "@/lib/ai/search"
import { resolveChatModelRoute } from "@/lib/ai/provider"
import {
  buildPromptCacheControls,
  looksLikePromptCacheControlRejection,
  mergePromptProviderOptions,
  parsePromptCacheRouteModes,
  resolvePromptCacheMode,
  resolvePromptCacheModeForRoute,
  selectPromptCacheTtl,
  type PromptCacheControls,
} from "@/lib/ai/prompt-cache"
import { buildPromptCacheAdapterPlan } from "@/lib/ai/prompt-cache-adapter"
import { createPromptCacheFallbackStream } from "@/lib/ai/prompt-cache-fallback-stream"
import { createModelAttemptCollector } from "@/lib/ai/model-attempt"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"
import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import {
  createResearchPlan,
  reasoningForResearchRoute,
  researchPlanExecutionPrompt,
  resolveResearchRoute,
} from "@/lib/chat/research-router"
import type { ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import {
  buildGenerationTools,
  type BuiltGenerationTools,
} from "@/lib/thread-chat/streaming/generation-tools"
import { throwIfGenerationCancelled } from "@/lib/ai/generation-cancellation"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"
import { OBSERVATION_NAMES } from "@/constants/observability"
import { observeAppOperation } from "@/lib/observability/trace"
import type { ObservabilityContext } from "@/lib/observability/types"
import {
  finalizeGenerationPrompt,
  type CompiledGenerationPrompt,
  type PromptBase,
} from "@/lib/thread-chat/application/prompt-compiler"
import type { PromptManifest } from "@/lib/thread-chat/application/prompt-cache"

export interface PrepareGenerationInput {
  userId: string
  messageId: string
  projectId: string
  threadId: string
  modelId: string
  observabilityContext: ObservabilityContext
  latestUserText: string
  recentConversation: string
  promptBase: PromptBase
  abortSignal: AbortSignal
}

function runtimeInstructions(input: {
  researchMode: "answer" | "fetch" | "search" | "research"
  researchPlan: Awaited<ReturnType<typeof createResearchPlan>> | null
  artifactRequested: boolean
}) {
  return {
    researchMode: input.researchMode,
    instructions: [
      input.researchMode === "fetch" ? DIRECT_FETCH_SYSTEM_PROMPT : null,
      input.researchMode === "search" || input.researchMode === "research"
        ? WEB_ACCESS_SYSTEM_PROMPT
        : null,
      input.researchMode === "research" ? RESEARCH_SYSTEM_PROMPT : null,
      input.researchPlan
        ? researchPlanExecutionPrompt(input.researchPlan)
        : null,
    ].filter((value): value is string => value !== null),
    artifactRequested: input.artifactRequested,
  }
}

function enabledEnv(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true"
}

function optionalPercent(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function hasCacheControls(input: {
  providerOptions: CompiledGenerationPrompt["providerOptions"]
  headers: CompiledGenerationPrompt["headers"]
  markerCount: number
}): boolean {
  return Boolean(
    input.markerCount > 0 ||
      (input.providerOptions && Object.keys(input.providerOptions).length > 0) ||
      (input.headers && Object.keys(input.headers).length > 0)
  )
}

export async function prepareGeneration(input: PrepareGenerationInput) {
  const registeredModel = getChatModel(input.modelId)
  if (!registeredModel) throw new Error("MODEL_NOT_ALLOWED")
  const resolved = resolveChatModelRoute(input.modelId)
  const model = resolved.model
  const trace = {
    requestId: crypto.randomUUID(),
    ...input.observabilityContext,
  }
  const searchReady = isSearchConfigured()
  const researchRoute = await observeAppOperation(
    OBSERVATION_NAMES.researchRoute,
    {
      metadata: {
        searchReady,
        assistantMessageId: input.messageId,
      },
    },
    async (observation) => {
      const route = await resolveResearchRoute({
        model,
        latestUserText: input.latestUserText,
        recentConversation: input.recentConversation,
        searchReady,
        modelCallTrace: trace,
        abortSignal: input.abortSignal,
      })
      observation.update({
        output: {
          mode: route.mode,
          reasonCode: route.reasonCode,
          urlCount: route.urls.length,
          suggestedQueryCount: route.suggestedQueries.length,
        },
      })
      return route
    }
  )
  const researchPlan =
    researchRoute.mode === "research"
      ? await observeAppOperation(
          OBSERVATION_NAMES.researchPlan,
          {
            metadata: {
              assistantMessageId: input.messageId,
              routeMode: researchRoute.mode,
            },
          },
          async (observation) => {
            const plan = await createResearchPlan({
              model,
              userRequest: input.latestUserText,
              route: researchRoute,
              modelCallTrace: trace,
              abortSignal: input.abortSignal,
            })
            observation.update({
              output: {
                subquestionCount: plan.subquestions.length,
                minimumIndependentSources:
                  plan.exitCriteria.minimumIndependentSources,
              },
            })
            return plan
          }
        )
      : null
  const artifactRequested = isExplicitMarkdownArtifactRequest(
    input.latestUserText
  )
  const built: BuiltGenerationTools = buildGenerationTools({
    messageId: input.messageId,
    artifactRequested,
    researchMode: researchRoute.mode,
    routeReason: researchRoute.reasonCode,
    searchReady,
  })
  const activeTools = Object.keys(built.tools) as Array<keyof typeof built.tools>
  const firstTool =
    researchRoute.mode === "fetch"
      ? "readUrl"
      : researchRoute.mode === "search" || researchRoute.mode === "research"
        ? "webSearch"
        : artifactRequested
          ? "createMarkdownArtifact"
          : null
  const runtimeControl = runtimeInstructions({
    researchMode: researchRoute.mode,
    researchPlan,
    artifactRequested,
  })

  // Compile once without controls to obtain route-neutral candidate boundaries.
  const preview = finalizeGenerationPrompt({
    base: input.promptBase,
    tools: built.tools,
    toolProfileId: built.profile.id,
    toolProfileHash: built.profile.hash,
    routeId: resolved.route.routeId,
    runtimeControl,
    contextWindowTokens: resolved.contextWindowTokens,
    minimumCachePrefixTokens: resolved.cache.minimumPrefixTokens,
  })
  const candidates = preview.manifest.candidateBoundaries
    .filter((boundary) => {
      if (boundary.kind === "inherited-end") {
        return input.promptBase.inheritedMessages.length > 0
      }
      if (boundary.kind === "branch-history-end") {
        return input.promptBase.branchHistoryMessages.length > 0
      }
      return true
    })
    .map((boundary) => ({
      kind: boundary.kind,
      tokenEstimate: boundary.tokenEstimate,
    }))

  const affinitySalt = process.env.THREAD_PROMPT_CACHE_AFFINITY_SALT
  const cacheMode = resolvePromptCacheModeForRoute({
    routeId: resolved.route.routeId,
    userId: input.userId,
    projectId: input.projectId,
    globalMode: resolvePromptCacheMode(),
    routeModes: parsePromptCacheRouteModes(),
    cohortPercent: optionalPercent(
      process.env.THREAD_PROMPT_CACHE_COHORT_PERCENT
    ),
    cohortSalt: affinitySalt,
  })
  const ttlClass = selectPromptCacheTtl({
    supportedTtls: resolved.cache.supportedTtls,
    extendedEnabled: enabledEnv(
      process.env.THREAD_PROMPT_CACHE_EXTENDED_TTL_ENABLED
    ),
    retentionAllowsExtended: enabledEnv(
      process.env.THREAD_PROMPT_CACHE_RETENTION_APPROVED
    ),
  })
  const adapterPlan = buildPromptCacheAdapterPlan({
    strategy: resolved.cache.strategy,
    candidates,
    minimumPrefixTokens: resolved.cache.minimumPrefixTokens ?? 0,
    maximumBreakpoints: resolved.cache.maxBreakpoints,
    ttlClass,
  })
  const baseControls = buildPromptCacheControls({
    resolved,
    userId: input.userId,
    projectId: input.projectId,
    mode: cacheMode,
    affinitySalt,
  })
  const controlsEnabled = baseControls.enabled && adapterPlan.enabled
  const providerOptions = controlsEnabled
    ? mergePromptProviderOptions(
        baseControls.providerOptions,
        adapterPlan.providerOptions
      )
    : undefined
  const headers = controlsEnabled ? baseControls.headers : undefined
  const markers = controlsEnabled ? adapterPlan.markers : []
  const cacheControls: PromptCacheControls = {
    mode: cacheMode,
    enabled: controlsEnabled,
    reason:
      cacheMode !== "enabled" ? baseControls.reason : adapterPlan.reason,
    strategy: resolved.cache.strategy,
    ttlClass,
    markerCount: markers.length,
    ...(providerOptions ? { providerOptions } : {}),
    ...(headers ? { headers } : {}),
    ...(controlsEnabled && baseControls.affinityHash
      ? { affinityHash: baseControls.affinityHash }
      : {}),
  }

  const compiled = finalizeGenerationPrompt({
    base: input.promptBase,
    tools: built.tools,
    toolProfileId: built.profile.id,
    toolProfileHash: built.profile.hash,
    routeId: resolved.route.routeId,
    runtimeControl,
    providerOptions,
    headers,
    cacheMarkers: markers,
    contextWindowTokens: resolved.contextWindowTokens,
    minimumCachePrefixTokens: resolved.cache.minimumPrefixTokens,
  })
  const fallbackCompiled = controlsEnabled
    ? finalizeGenerationPrompt({
        base: input.promptBase,
        tools: built.tools,
        toolProfileId: built.profile.id,
        toolProfileHash: built.profile.hash,
        routeId: resolved.route.routeId,
        runtimeControl,
        contextWindowTokens: resolved.contextWindowTokens,
        minimumCachePrefixTokens: resolved.cache.minimumPrefixTokens,
      })
    : compiled
  const attemptCollector = createModelAttemptCollector({
    purpose: MODEL_CALL_PURPOSE.chatAnswer,
    routeId: resolved.route.routeId,
    upstreamModelId: resolved.route.upstreamModelId,
    adapter: resolved.route.adapter,
    gateway: resolved.route.gateway,
    toolProfileId: built.profile.id,
    stableRequestPrefixHash: compiled.manifest.stableRequestPrefixHash,
    cacheStrategy: resolved.cache.strategy,
    cacheEligibility: compiled.manifest.cacheEligibility.reason,
  })

  const startStream = (
    prompt: CompiledGenerationPrompt
  ): {
    stream: ReadableStream<TextStreamPart<ToolSet>>
    usage: PromiseLike<LanguageModelUsage>
  } => {
    const result = streamText({
      ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.chatAnswer, {
        ...trace,
        modelId: input.modelId,
        providerRouteId: resolved.route.routeId,
        toolProfileId: built.profile.id,
        stableRequestPrefixHash: prompt.manifest.stableRequestPrefixHash,
        cacheEligibility: prompt.manifest.cacheEligibility.reason,
      }),
      model: withModelCallLogging(model, MODEL_CALL_PURPOSE.chatAnswer, trace),
      abortSignal: input.abortSignal,
      reasoning: reasoningForResearchRoute(researchRoute.mode, registeredModel),
      system: prompt.system,
      messages: prompt.messages,
      tools: built.tools,
      ...(prompt.providerOptions
        ? { providerOptions: prompt.providerOptions }
        : {}),
      ...(prompt.headers ? { headers: prompt.headers } : {}),
      onStepFinish: (step) => {
        attemptCollector.recordStep(step)
      },
      ...(activeTools.length > 0
        ? {
            prepareStep: ({ stepNumber }: { stepNumber: number }) => ({
              activeTools,
              ...(stepNumber === 0 && firstTool
                ? { toolChoice: { type: "tool" as const, toolName: firstTool } }
                : {}),
            }),
          }
        : {}),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: isStepCount(
        researchRoute.mode === "answer" ? 5 : RESEARCH_MAX_STEPS
      ),
    })
    return {
      stream: result.stream as ReadableStream<TextStreamPart<ToolSet>>,
      usage: result.usage,
    }
  }

  throwIfGenerationCancelled(input.abortSignal)
  const fallbackEnabled =
    controlsEnabled &&
    hasCacheControls({
      providerOptions: compiled.providerOptions,
      headers: compiled.headers,
      markerCount: markers.length,
    })
  const wrapped = createPromptCacheFallbackStream({
    primary: () => startStream(compiled),
    fallback: () => startStream(fallbackCompiled),
    isCacheControlRejection: looksLikePromptCacheControlRejection,
    enabled: fallbackEnabled,
    onFallback: () => {
      console.warn(
        `[prompt-cache] route ${resolved.route.routeId} rejected cache controls; retried without cache controls`
      )
    },
  })

  const leadingChunks: ThreadChatUIMessageChunk[] = [
    {
      type: "data-research-route",
      id: "research-route",
      data: researchRoute,
    },
    ...(researchPlan
      ? [
          {
            type: "data-research-plan" as const,
            id: "research-plan",
            data: researchPlan,
          },
        ]
      : []),
  ]
  const syncTtft = () => attemptCollector.setTtftMs(wrapped.ttftMs())
  return {
    textStream: wrapped.stream,
    tools: built.tools as ToolSet,
    leadingChunks,
    usage: wrapped.usage,
    manifest: compiled.manifest,
    cacheControls,
    route: resolved.route,
    modelAttempts: () => {
      syncTtft()
      return attemptCollector.snapshot()
    },
    cacheSummary: () => {
      syncTtft()
      return attemptCollector.summary()
    },
    cacheFallbackUsed: wrapped.usedFallback,
    ttftMs: wrapped.ttftMs,
  }
}

export type PreparedPromptManifest = PromptManifest
