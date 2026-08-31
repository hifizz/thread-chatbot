import { isStepCount, streamText, type ToolSet } from "ai"
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
  resolvePromptCacheMode,
} from "@/lib/ai/prompt-cache"
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
  const cacheControls = buildPromptCacheControls({
    resolved,
    userId: input.userId,
    projectId: input.projectId,
    mode: resolvePromptCacheMode(),
    affinitySalt: process.env.THREAD_PROMPT_CACHE_AFFINITY_SALT,
  })
  const compiled = finalizeGenerationPrompt({
    base: input.promptBase,
    tools: built.tools,
    toolProfileId: built.profile.id,
    toolProfileHash: built.profile.hash,
    routeId: resolved.route.routeId,
    runtimeControl: runtimeInstructions({
      researchMode: researchRoute.mode,
      researchPlan,
      artifactRequested,
    }),
    providerOptions: cacheControls.providerOptions,
    headers: cacheControls.headers,
    contextWindowTokens: resolved.contextWindowTokens,
    minimumCachePrefixTokens: resolved.cache.minimumPrefixTokens,
  })
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

  throwIfGenerationCancelled(input.abortSignal)
  const result = streamText({
    ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.chatAnswer, {
      ...trace,
      modelId: input.modelId,
      providerRouteId: resolved.route.routeId,
      toolProfileId: built.profile.id,
      stableRequestPrefixHash: compiled.manifest.stableRequestPrefixHash,
      cacheEligibility: compiled.manifest.cacheEligibility.reason,
    }),
    model: withModelCallLogging(model, MODEL_CALL_PURPOSE.chatAnswer, trace),
    abortSignal: input.abortSignal,
    reasoning: reasoningForResearchRoute(researchRoute.mode, registeredModel),
    system: compiled.system,
    messages: compiled.messages,
    tools: built.tools,
    ...(compiled.providerOptions
      ? { providerOptions: compiled.providerOptions }
      : {}),
    ...(compiled.headers ? { headers: compiled.headers } : {}),
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
  return {
    textStream: result.stream as ReadableStream<
      import("ai").TextStreamPart<ToolSet>
    >,
    tools: built.tools as ToolSet,
    leadingChunks,
    usage: result.usage,
    manifest: compiled.manifest,
    cacheControls,
    route: resolved.route,
    modelAttempts: () => attemptCollector.snapshot(),
    cacheSummary: () => attemptCollector.summary(),
  }
}

export type PreparedPromptManifest = PromptManifest
