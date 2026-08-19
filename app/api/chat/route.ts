import {
  convertToModelMessages,
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai"
import { after } from "next/server"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import type { ToolJSONSchema } from "assistant-stream"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import { isSearchConfigured } from "@/lib/ai/search"
import { RESEARCH_MAX_STEPS } from "@/constants/research"
import { getCurrentUserId } from "@/lib/auth/server"
import {
  DEFAULT_MODEL_ID,
  getChatModel,
  isUnbilledPreviewModel,
  MAX_OUTPUT_TOKENS,
} from "@/constants/model"
import { resolveChatModel, isModelConfigured } from "@/lib/ai/provider"
import { hasPositiveBalance } from "@/lib/billing/credits"
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

// AnySearch 搜索与网页深读可能形成多步循环，放宽单次请求时长上限。
export const maxDuration = 300

export async function POST(req: Request) {
  // 1) 鉴权：未登录直接拒绝
  const userId = await getCurrentUserId()
  if (!userId) {
    return Response.json(
      { error: "请先登录后再使用对话功能。" },
      { status: 401 }
    )
  }

  const {
    messages,
    tools,
    deepResearch,
    threadChat,
    modelId: rawModelId,
    id: linearThreadId,
  }: {
    messages: UIMessage[]
    tools?: Record<string, ToolJSONSchema>
    deepResearch?: boolean
    /** thread-chat 分支对话页的模式标记：system 由服务端按锚点原文构造 */
    threadChat?: unknown
    modelId?: unknown
    id?: string
  } = await req.json()

  // 2) 解析并校验所选模型
  if (
    rawModelId !== undefined &&
    (typeof rawModelId !== "string" || !getChatModel(rawModelId))
  ) {
    return Response.json({ error: "未知或无效的模型。" }, { status: 400 })
  }
  const modelId = typeof rawModelId === "string" ? rawModelId : DEFAULT_MODEL_ID
  const model = getChatModel(modelId)!
  if (!isModelConfigured(model)) {
    return Response.json(
      {
        error: `模型「${model.name}」未配置，请联系管理员在服务端配置对应 API Key 或可用网关。`,
      },
      { status: 400 }
    )
  }

  const isUnbilledPreview = isUnbilledPreviewModel(model)

  // 3) 计费拦截：未计费预览模型不依赖用户余额。
  if (!isUnbilledPreview && !(await hasPositiveBalance(userId))) {
    return Response.json({ error: "额度不足，请充值后再试。" }, { status: 402 })
  }

  const prepared = await prepareThreadGenerationContext({
    userId,
    modelId,
    messages,
    threadChat,
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
    const { latestText, researchRoute, researchPlan } =
      await resolveResearchContext({
        model: chatModel,
        messages: authoritativeMessages,
        deepResearchRequested: research,
        searchReady,
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
      model: chatModel,
      ...(generationController
        ? { abortSignal: generationController.signal }
        : {}),
      reasoning: reasoningForResearchRoute(researchRoute.mode),
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
