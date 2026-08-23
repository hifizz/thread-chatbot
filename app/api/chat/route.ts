import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
} from "ai"
import { frontendTools } from "@assistant-ui/react-ai-sdk"

import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { RESEARCH_MAX_STEPS } from "@/constants/research"
import { isSearchConfigured } from "@/lib/ai/search"
import { resolveChatModel } from "@/lib/ai/provider"
import {
  withModelCallLogging,
  type ModelCallTrace,
} from "@/lib/ai/model-call-logger"
import { buildUsageMetadata } from "@/lib/billing/usage-meta"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import { reasoningForResearchRoute } from "@/lib/chat/research-router"

import { prepareChatRequestContext } from "./request-context"
import { resolveResearchContext } from "./research-context"
import { createLinearStreamLifecycle } from "./stream-lifecycle"
import { buildChatSystemPrompt } from "./system-prompt"
import { buildChatToolSet } from "./tool-set"
import { createToolStepPolicy } from "./tool-step-policy"

export const maxDuration = 300

export async function POST(req: Request) {
  const requestContext = await prepareChatRequestContext(req)
  if (requestContext.kind === "response") return requestContext.response
  const {
    userId,
    messages,
    tools,
    deepResearch,
    linearThreadId,
    modelId,
    model,
    isUnbilledPreview,
  } = requestContext

  try {
    const research = deepResearch === true
    const searchReady = isSearchConfigured()
    const chatModel = resolveChatModel(modelId)
    const modelCallTrace: ModelCallTrace = {
      requestId: crypto.randomUUID(),
      ...(linearThreadId ? { threadId: linearThreadId } : {}),
    }
    const { researchRoute, researchPlan } = await resolveResearchContext({
      model: chatModel,
      messages,
      deepResearchRequested: research,
      searchReady,
      modelCallTrace,
    })
    const { tools: allTools, webToolsEnabled } = buildChatToolSet({
      researchMode: researchRoute.mode,
      searchReady,
      threadChat: false,
      markdownArtifactRequested: false,
      frontendToolSet: frontendTools(tools ?? {}),
    })
    const resolvedMessages = await resolveAttachmentParts(messages)
    const lifecycle = createLinearStreamLifecycle({
      userId,
      modelId,
      model,
      unbilledPreview: isUnbilledPreview,
      linearThreadId,
    })
    const result = streamText({
      model: withModelCallLogging(
        chatModel,
        MODEL_CALL_PURPOSE.chatAnswer,
        modelCallTrace
      ),
      reasoning: reasoningForResearchRoute(researchRoute.mode, model),
      system: buildChatSystemPrompt({
        threadChat: false,
        anchorText: null,
        markdownArtifactRequested: false,
        researchMode: researchRoute.mode,
        researchPlan,
        deepResearchRequested: research,
        searchReady,
      }),
      messages: await convertToModelMessages(resolvedMessages, {
        tools: allTools,
      }),
      tools: allTools,
      prepareStep: createToolStepPolicy({
        isThreadChat: false,
        markdownArtifactRequested: false,
        researchMode: researchRoute.mode,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: isStepCount(webToolsEnabled ? RESEARCH_MAX_STEPS : 5),
      onError: lifecycle.onError,
      onEnd: lifecycle.onEnd,
    })
    const uiStream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({
          type: "data-research-route",
          id: "research-route",
          data: researchRoute,
        })
        if (researchPlan)
          writer.write({
            type: "data-research-plan",
            id: "research-plan",
            data: researchPlan,
          })
        writer.merge(
          result.toUIMessageStream({
            onError: (error) => {
              console.error("[chat] 流内错误:", error)
              return "An error occurred."
            },
            messageMetadata: ({ part }) =>
              part.type === "finish"
                ? buildUsageMetadata(modelId, part.totalUsage)
                : undefined,
          })
        )
      },
    })
    return createUIMessageStreamResponse({ stream: uiStream })
  } catch (error) {
    console.error("[chat] 请求初始化失败", error)
    return Response.json({ error: "生成初始化失败，请重试。" }, { status: 500 })
  }
}
