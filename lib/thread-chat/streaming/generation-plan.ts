import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai"
import type { GenerationSettings } from "@/constants/generation-settings"
import { THREAD_CHAT_PROMPT_SCHEMA_VERSION } from "@/constants/thread-chat-prompt"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { getChatModel } from "@/constants/model"
import { isSearchConfigured } from "@/lib/ai/search"
import { resolveChatModelWithRoute } from "@/lib/ai/llm/model-routes"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"
import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import {
  createResearchPlan,
  researchPlanExecutionPrompt,
  resolveResearchRoute,
} from "@/lib/chat/research-router"
import {
  buildProjectContractContext,
  type ProjectContractContextInput,
} from "@/lib/chat/project-contract"
import type { ProjectFileContextStats } from "@/lib/chat/resolve-attachments"
import type { ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import { buildGenerationTools } from "@/lib/thread-chat/streaming/generation-tools"
import { resolveGenerationMode } from "@/lib/thread-chat/streaming/generation-modes"
import { resolvePromptCachePolicy } from "@/lib/thread-chat/streaming/prompt-cache-policy"
import {
  decoratePromptCache,
  type PromptCacheBoundaries,
} from "@/lib/thread-chat/streaming/prompt-cache-decorator"
import { chatAnswerGenerationOptions } from "@/lib/thread-chat/streaming/generation-settings"
import { throwIfGenerationCancelled } from "@/lib/ai/generation-cancellation"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"
import { OBSERVATION_NAMES } from "@/constants/observability"
import { observeAppOperation } from "@/lib/observability/trace"
import type { ObservabilityContext } from "@/lib/observability/types"

export interface PrepareGenerationInput {
  messageId: string
  projectId: string
  threadId: string
  modelId: string
  generationSettings?: GenerationSettings
  observabilityContext: ObservabilityContext
  latestUserText: string
  recentConversation: string
  projectContract: ProjectContractContextInput
  projectFileStats: ProjectFileContextStats
  modelMessages: ModelMessage[]
  promptCacheBoundaries: PromptCacheBoundaries
  abortSignal: AbortSignal
}

export async function prepareGeneration(input: PrepareGenerationInput) {
  const registeredModel = getChatModel(input.modelId)
  if (!registeredModel) throw new Error("MODEL_NOT_ALLOWED")
  const resolvedModel = resolveChatModelWithRoute(input.modelId)
  const model = resolvedModel.model
  const trace = {
    requestId: crypto.randomUUID(),
    ...input.observabilityContext,
  }
  const contextMetadata = {
    projectContractVersion: input.projectContract.version,
    hasProjectTarget: Boolean(input.projectContract.target),
    hasProjectInstructions: Boolean(input.projectContract.instructions),
    projectFileCount: input.projectFileStats.totalCount,
    readyProjectFileCount: input.projectFileStats.readyCount,
    selectedProjectFileCount: input.projectFileStats.selectedCount,
    projectFileContextChars: input.projectFileStats.contextChars,
    projectFileContextMode: input.projectFileStats.mode,
    ...(input.generationSettings
      ? {
          generationEffort: input.generationSettings.effort,
          generationMaxOutputTokens: input.generationSettings.maxOutputTokens,
        }
      : {}),
  }
  const searchReady = isSearchConfigured()
  const researchRoute = await observeAppOperation(
    OBSERVATION_NAMES.researchRoute,
    {
      metadata: {
        searchReady,
        assistantMessageId: input.messageId,
        ...contextMetadata,
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
              ...contextMetadata,
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
  const generationMode = resolveGenerationMode({
    researchMode: researchRoute.mode,
    artifactRequested,
  })
  const tools = buildGenerationTools({
    messageId: input.messageId,
    toolNames: searchReady
      ? generationMode.toolNames
      : generationMode.toolNames.filter(
          (name) => name === "createMarkdownArtifact"
        ),
    routeReason: researchRoute.reasonCode,
  })
  const activeTools = Object.keys(tools)
  const projectContract = buildProjectContractContext(input.projectContract)
  const stableInstructions = [
    ...generationMode.systemParts.slice(0, 1),
    projectContract,
    ...generationMode.systemParts.slice(1),
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n")
  const instructions = [
    { role: "system" as const, content: stableInstructions },
    ...(researchPlan
      ? [
          {
            role: "system" as const,
            content: researchPlanExecutionPrompt(researchPlan),
          },
        ]
      : []),
  ]

  const cachePolicy = resolvePromptCachePolicy(resolvedModel.route)
  const cachedPrompt = decoratePromptCache({
    instructions,
    messages: input.modelMessages,
    boundaries: input.promptCacheBoundaries,
    policy: cachePolicy,
  })

  throwIfGenerationCancelled(input.abortSignal)
  const generationOptions = chatAnswerGenerationOptions(
    researchRoute.mode,
    input.generationSettings
  )
  const result = streamText({
    ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.chatAnswer, {
      ...trace,
      modelId: input.modelId,
    }),
    model: withModelCallLogging(model, MODEL_CALL_PURPOSE.chatAnswer, trace),
    abortSignal: input.abortSignal,
    ...generationOptions,
    instructions: cachedPrompt.instructions,
    messages: cachedPrompt.messages,
    tools,
    ...(activeTools.length > 0
      ? {
          prepareStep: ({ stepNumber }: { stepNumber: number }) => ({
            activeTools,
            ...(stepNumber === 0 && generationMode.firstTool
              ? {
                  toolChoice: {
                    type: "tool" as const,
                    toolName: generationMode.firstTool as string,
                  },
                }
              : {}),
          }),
        }
      : {}),
    stopWhen: isStepCount(generationMode.maxSteps),
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
    tools: tools as ToolSet,
    leadingChunks,
    usage: result.usage,
    contextMetadata: {
      ...contextMetadata,
      generationMode: generationMode.id,
      promptSchemaVersion: THREAD_CHAT_PROMPT_SCHEMA_VERSION,
      actualProvider: resolvedModel.route.actualProvider,
      protocol: resolvedModel.route.protocol,
      credentialGroup: resolvedModel.route.credentialGroup,
      upstreamModel: resolvedModel.route.upstreamModel,
      explicitCacheEnabled: cachePolicy.explicitCacheEnabled,
      promptCacheBreakpointCount: cachedPrompt.breakpointCount,
    },
    promptCacheContext: {
      route: resolvedModel.route,
      generationMode: generationMode.id,
      promptSchemaVersion: THREAD_CHAT_PROMPT_SCHEMA_VERSION,
      projectContractVersion: input.projectContract.version,
      explicitCacheEnabled: cachePolicy.explicitCacheEnabled,
    },
  }
}
