import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai"
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
import { resolveChatModel } from "@/lib/ai/llm/model-routes"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"
import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import {
  createResearchPlan,
  reasoningForResearchRoute,
  researchPlanExecutionPrompt,
  resolveResearchRoute,
} from "@/lib/chat/research-router"
import {
  buildProjectContractContext,
  type ProjectContractContextInput,
} from "@/lib/chat/project-contract"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import type { ProjectFileContextStats } from "@/lib/chat/resolve-attachments"
import type { ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import { buildGenerationTools } from "@/lib/thread-chat/streaming/generation-tools"
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
  observabilityContext: ObservabilityContext
  latestUserText: string
  recentConversation: string
  anchorText: string | null
  projectContract: ProjectContractContextInput
  projectFileStats: ProjectFileContextStats
  modelMessages: ModelMessage[]
  abortSignal: AbortSignal
}

export async function prepareGeneration(input: PrepareGenerationInput) {
  const registeredModel = getChatModel(input.modelId)
  if (!registeredModel) throw new Error("MODEL_NOT_ALLOWED")
  const model = resolveChatModel(input.modelId)
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
  const tools = buildGenerationTools({
    messageId: input.messageId,
    artifactRequested,
    researchMode: researchRoute.mode,
    routeReason: researchRoute.reasonCode,
    searchReady,
  })
  const activeTools = Object.keys(tools) as Array<keyof typeof tools>
  const firstTool =
    researchRoute.mode === "fetch"
      ? "readUrl"
      : researchRoute.mode === "search" || researchRoute.mode === "research"
        ? "webSearch"
        : artifactRequested
          ? "createMarkdownArtifact"
          : null
  const projectContract = buildProjectContractContext(input.projectContract)
  const system = [
    buildThreadChatSystem(input.anchorText, {
      enableMarkdownArtifact: artifactRequested,
    }),
    projectContract,
    researchRoute.mode === "fetch" ? DIRECT_FETCH_SYSTEM_PROMPT : null,
    researchRoute.mode === "search" || researchRoute.mode === "research"
      ? WEB_ACCESS_SYSTEM_PROMPT
      : null,
    researchRoute.mode === "research" ? RESEARCH_SYSTEM_PROMPT : null,
    researchPlan ? researchPlanExecutionPrompt(researchPlan) : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n")

  throwIfGenerationCancelled(input.abortSignal)
  const result = streamText({
    ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.chatAnswer, {
      ...trace,
      modelId: input.modelId,
    }),
    model: withModelCallLogging(model, MODEL_CALL_PURPOSE.chatAnswer, trace),
    abortSignal: input.abortSignal,
    reasoning: reasoningForResearchRoute(researchRoute.mode),
    system,
    messages: input.modelMessages,
    tools,
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
    tools: tools as ToolSet,
    leadingChunks,
    usage: result.usage,
    contextMetadata,
  }
}
