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
import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import { reasoningForResearchRoute } from "@/lib/chat/research-router"
import { unregisterGenerationController } from "@/lib/thread-chat-generation/execution"
import { createToolStepPolicy } from "@/app/api/chat/tool-step-policy"
import { buildChatSystemPrompt } from "@/app/api/chat/system-prompt"
import { resolveResearchContext } from "@/app/api/chat/research-context"
import { buildChatToolSet } from "@/app/api/chat/tool-set"
import { createStreamLifecycle } from "@/app/api/chat/stream-lifecycle"
import {
  createGenerationSettlementHandler,
  settleGenerationInitializationFailure,
} from "@/app/api/chat/generation-settlement"
import { prepareThreadGenerationContext } from "@/app/api/chat/thread-generation-context"
import { prepareChatRequestContext } from "@/app/api/chat/request-context"

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
    threadChat,
    linearThreadId,
    modelId,
    model,
    isUnbilledPreview,
  } = requestContext

  const prepared = await prepareThreadGenerationContext({
    userId,
    modelId,
    messages,
    threadChat,
    unbilledPreview: isUnbilledPreview,
  })
  if (prepared.kind === "response") return prepared.response
  const {
    persistence,
    authoritativeMessages,
    authoritativeAnchorText,
    preparedRevision,
    generationController,
    generationObserver,
  } = prepared

  try {
    // AnySearch 是当前统一联网层：所有模型都获得相同的搜索与网页深读工具。
    // deepResearch 只控制研究提示强度，不再决定工具是否存在。
    const research = deepResearch === true
    const searchReady = isSearchConfigured()
    const isThreadChat = persistence != null
    const chatModel = resolveChatModel(modelId)
    const modelCallTrace: ModelCallTrace = {
      requestId: crypto.randomUUID(),
      ...(persistence
        ? {
            treeId: persistence.treeId,
            threadId: persistence.threadId,
            generationId: persistence.generationId,
            assistantMessageId: persistence.assistantMessageId,
          }
        : linearThreadId
          ? { threadId: linearThreadId }
          : {}),
    }
    const { latestText, researchRoute, researchPlan } =
      await resolveResearchContext({
        model: chatModel,
        messages: authoritativeMessages,
        deepResearchRequested: research,
        searchReady,
        modelCallTrace,
      })
    const markdownArtifactRequested =
      isThreadChat && isExplicitMarkdownArtifactRequest(latestText)
    const { tools: allTools, webToolsEnabled } = buildChatToolSet({
      researchMode: researchRoute.mode,
      searchReady,
      threadChat: isThreadChat,
      markdownArtifactRequested,
      frontendToolSet: frontendTools(tools ?? {}),
    })

    // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
    const resolvedMessages = await resolveAttachmentParts(authoritativeMessages)

    const system = buildChatSystemPrompt({
      threadChat: isThreadChat,
      anchorText: authoritativeAnchorText,
      markdownArtifactRequested,
      researchMode: researchRoute.mode,
      researchPlan,
      deepResearchRequested: research,
      searchReady,
    })

    const streamLifecycle = createStreamLifecycle({
      userId,
      modelId,
      model,
      persistentGeneration: isThreadChat,
      unbilledPreview: isUnbilledPreview,
      linearThreadId,
    })

    const result = streamText({
      model: withModelCallLogging(
        chatModel,
        MODEL_CALL_PURPOSE.chatAnswer,
        modelCallTrace
      ),
      ...(generationController
        ? { abortSignal: generationController.signal }
        : {}),
      reasoning: reasoningForResearchRoute(researchRoute.mode, model),
      system,
      messages: await convertToModelMessages(resolvedMessages, {
        tools: allTools,
      }),
      tools: allTools,
      // 明确 Markdown 交付请求只强制第 0 步启动工具调用；后续步骤仍保留工具，
      // 让模型在用户要求多份独立文档时，为每份文档分别创建一个 Artifact。
      prepareStep: createToolStepPolicy({
        isThreadChat,
        markdownArtifactRequested,
        researchMode: researchRoute.mode,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: isStepCount(webToolsEnabled ? RESEARCH_MAX_STEPS : 5),
      onError: streamLifecycle.onError,
      onAbort: streamLifecycle.onAbort,
      onEnd: streamLifecycle.onEnd,
    })

    const uiStream = createUIMessageStream({
      ...(persistence
        ? {
            originalMessages: resolvedMessages,
            generateId: () => persistence.assistantMessageId,
          }
        : {}),
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
      onEnd: persistence
        ? createGenerationSettlementHandler({
            persistence,
            researchRoute,
            researchPlan,
            unbilledPreview: isUnbilledPreview,
            streamLifecycle,
          })
        : undefined,
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
          generationObserver?.stop()
          if (generationObserver) await generationObserver.done
          if (persistence && generationController) {
            unregisterGenerationController(
              persistence.generationId,
              generationController
            )
          }
        })
      },
    })
    if (preparedRevision !== null)
      response.headers.set("x-thread-tree-revision", String(preparedRevision))
    return response
  } catch (error) {
    generationController?.abort(error)
    generationObserver?.stop()
    if (persistence && generationController) {
      unregisterGenerationController(
        persistence.generationId,
        generationController
      )
      await settleGenerationInitializationFailure({
        persistence,
        error,
        usageUnavailable: !isUnbilledPreview,
      })
    }
    console.error("[chat] 请求初始化失败", error)
    return Response.json({ error: "生成初始化失败，请重试。" }, { status: 500 })
  }
}
