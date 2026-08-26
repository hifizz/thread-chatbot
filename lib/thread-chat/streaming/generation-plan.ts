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
import { resolveChatModel } from "@/lib/ai/provider"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"
import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import {
  createResearchPlan,
  reasoningForResearchRoute,
  researchPlanExecutionPrompt,
  resolveResearchRoute,
} from "@/lib/chat/research-router"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import type { ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import { buildGenerationTools } from "@/lib/thread-chat/streaming/generation-tools"

export interface PrepareGenerationInput {
  messageId: string
  threadId: string
  modelId: string
  latestUserText: string
  recentConversation: string
  anchorText: string | null
  modelMessages: ModelMessage[]
  abortSignal: AbortSignal
}

export async function prepareGeneration(input: PrepareGenerationInput) {
  const registeredModel = getChatModel(input.modelId)
  if (!registeredModel) throw new Error("MODEL_NOT_ALLOWED")
  const model = resolveChatModel(input.modelId)
  const trace = {
    requestId: crypto.randomUUID(),
    threadId: input.threadId,
    assistantMessageId: input.messageId,
  }
  const searchReady = isSearchConfigured()
  const researchRoute = await resolveResearchRoute({
    model,
    latestUserText: input.latestUserText,
    recentConversation: input.recentConversation,
    searchReady,
    modelCallTrace: trace,
    abortSignal: input.abortSignal,
  })
  const researchPlan =
    researchRoute.mode === "research"
      ? await createResearchPlan({
          model,
          userRequest: input.latestUserText,
          route: researchRoute,
          modelCallTrace: trace,
          abortSignal: input.abortSignal,
        })
      : null
  const artifactRequested = isExplicitMarkdownArtifactRequest(
    input.latestUserText
  )
  const tools = buildGenerationTools({
    messageId: input.messageId,
    artifactRequested,
    researchMode: researchRoute.mode,
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
  const system = [
    buildThreadChatSystem(input.anchorText, {
      enableMarkdownArtifact: artifactRequested,
    }),
    researchRoute.mode === "fetch" ? DIRECT_FETCH_SYSTEM_PROMPT : null,
    researchRoute.mode === "search" || researchRoute.mode === "research"
      ? WEB_ACCESS_SYSTEM_PROMPT
      : null,
    researchRoute.mode === "research" ? RESEARCH_SYSTEM_PROMPT : null,
    researchPlan ? researchPlanExecutionPrompt(researchPlan) : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n")

  const result = streamText({
    model: withModelCallLogging(model, MODEL_CALL_PURPOSE.chatAnswer, trace),
    abortSignal: input.abortSignal,
    reasoning: reasoningForResearchRoute(researchRoute.mode, registeredModel),
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
  }
}
