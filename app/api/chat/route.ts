import {
  convertToModelMessages,
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
} from "ai"
import { after } from "next/server"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import { isSearchConfigured } from "@/lib/ai/search"
import { RESEARCH_MAX_STEPS } from "@/constants/research"
import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { resolveChatModel } from "@/lib/ai/provider"
import {
  withModelCallLogging,
  type ModelCallTrace,
} from "@/lib/ai/model-call-logger"
import { buildUsageMetadata } from "@/lib/billing/usage-meta"
import { reasoningForResearchRoute } from "@/lib/chat/research-router"
import { createToolStepPolicy } from "@/app/api/chat/tool-step-policy"
import { buildChatSystemPrompt } from "@/app/api/chat/system-prompt"
import { resolveResearchContext } from "@/app/api/chat/research-context"
import { buildChatToolSet } from "@/app/api/chat/tool-set"
import { createStreamLifecycle } from "@/app/api/chat/stream-lifecycle"
import { prepareChatRequestContext } from "@/app/api/chat/request-context"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"

// AnySearch 搜索与网页深读可能形成多步循环，放宽单次请求时长上限。
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
    // AnySearch 是当前统一联网层：所有模型都获得相同的搜索与网页深读工具。
    // deepResearch 只控制研究提示强度，不再决定工具是否存在。
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
      frontendToolSet: frontendTools(tools ?? {}),
    })

    // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
    const resolvedMessages = await resolveAttachmentParts(messages, userId)

    const system = buildChatSystemPrompt({
      researchMode: researchRoute.mode,
      researchPlan,
      deepResearchRequested: research,
      searchReady,
    })

    const streamLifecycle = createStreamLifecycle({
      userId,
      modelId,
      model,
      unbilledPreview: isUnbilledPreview,
      linearThreadId,
    })

    const result = streamText({
      ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.chatAnswer, {
        ...modelCallTrace,
        modelId,
        entrypoint: "legacy-chat",
      }),
      model: withModelCallLogging(
        chatModel,
        MODEL_CALL_PURPOSE.chatAnswer,
        modelCallTrace
      ),
      reasoning: reasoningForResearchRoute(researchRoute.mode, model),
      system,
      messages: await convertToModelMessages(resolvedMessages, {
        tools: allTools,
      }),
      tools: allTools,
      // 明确 Markdown 交付请求只强制第 0 步启动工具调用；后续步骤仍保留工具，
      // 让模型在用户要求多份独立文档时，为每份文档分别创建一个 Artifact。
      prepareStep: createToolStepPolicy({
        isThreadChat: false,
        markdownArtifactRequested: false,
        researchMode: researchRoute.mode,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: isStepCount(webToolsEnabled ? RESEARCH_MAX_STEPS : 5),
      onError: streamLifecycle.onError,
      onAbort: streamLifecycle.onAbort,
      onEnd: streamLifecycle.onEnd,
    })

    const uiStream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({
          type: "data-research-route",
          id: "research-route",
          data: researchRoute,
        })
        if (researchPlan) {
          writer.write({
            type: "data-research-plan",
            id: "research-plan",
            data: researchPlan,
          })
        }
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

    const response = createUIMessageStreamResponse({
      stream: uiStream,
      consumeSseStream: ({ stream }) => {
        after(async () => {
          await consumeStream({
            stream,
            onError: (error) => {
              console.error("[chat] 服务端 UI stream 消费失败", error)
            },
          })
        })
      },
    })
    return response
  } catch (error) {
    console.error("[chat] 请求初始化失败", error)
    return Response.json({ error: "生成初始化失败，请重试。" }, { status: 500 })
  }
}
