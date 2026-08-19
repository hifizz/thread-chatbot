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
  isThreadChatModelId,
  isUnbilledPreviewModel,
  MAX_OUTPUT_TOKENS,
} from "@/constants/model"
import { resolveChatModel, isModelConfigured } from "@/lib/ai/provider"
import { openRouterCostUsdFromSteps } from "@/lib/ai/openrouter"
import { hasPositiveBalance, chargeUsage } from "@/lib/billing/credits"
import { buildUsageMetadata } from "@/lib/billing/usage-meta"
import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import { reasoningForResearchRoute } from "@/lib/chat/research-router"
import { prepareGeneration } from "@/lib/thread-chat-generation/start-generation-repository"
import { toGenerationSummary } from "@/lib/thread-chat-generation/query-repository"
import {
  observeGenerationCancellation,
  registerGenerationController,
  unregisterGenerationController,
} from "@/lib/thread-chat-generation/execution"
import type { FinalizeGenerationUsage } from "@/lib/thread-chat-generation/finalize"
import { finalizeGenerationWithRetry } from "@/lib/thread-chat-generation/finalize-with-retry"
import { projectGenerationResult } from "@/lib/thread-chat/application/project-generation-result"
import { GENERATION_ERRORS } from "@/constants/generation"
import { compileThreadChatMessages } from "@/lib/thread-chat/application/compile-thread-chat-messages"
import {
  threadChatGenerationIdentitySchema,
  type ThreadChatGenerationIdentity,
} from "@/lib/thread-chat/contracts/generation-identity"
import { generationStartErrorResponse } from "@/app/api/chat/generation-start-error"
import { createToolStepPolicy } from "@/app/api/chat/tool-step-policy"
import { buildChatSystemPrompt } from "@/app/api/chat/system-prompt"
import { resolveResearchContext } from "@/app/api/chat/research-context"
import { buildChatToolSet } from "@/app/api/chat/tool-set"

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

  let persistence: ThreadChatGenerationIdentity | null = null
  let authoritativeMessages = messages
  let authoritativeAnchorText: string | null = null
  let preparedRevision: number | null = null
  let generationController: AbortController | null = null
  let generationObserver: ReturnType<
    typeof observeGenerationCancellation
  > | null = null
  if (threadChat != null) {
    const parsed = threadChatGenerationIdentitySchema.safeParse(threadChat)
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "invalid_generation_identity",
            message: "thread-chat 请求缺少有效的持久化身份，请刷新页面后重试",
          },
        },
        { status: 400 }
      )
    }
    persistence = parsed.data
    if (!isThreadChatModelId(modelId)) {
      return Response.json(
        {
          error: {
            code: "invalid_thread_model",
            message: "Thread Chat 不允许使用该模型，请刷新页面后重试",
          },
        },
        { status: 400 }
      )
    }
    try {
      const started = await prepareGeneration({
        userId,
        modelId,
        ...persistence,
      })
      if (!started.created) {
        return Response.json(
          { generation: toGenerationSummary(started.generation) },
          { status: 202 }
        )
      }
      preparedRevision = started.revision
      const committedThread = started.state.threads[persistence.threadId]
      authoritativeAnchorText = committedThread?.anchorText?.trim()
        ? committedThread.anchorText
        : null
      authoritativeMessages = compileThreadChatMessages({
        state: started.state,
        threadId: persistence.threadId,
        excludeAssistantMessageId: persistence.assistantMessageId,
      }) as UIMessage[]
    } catch (error) {
      return generationStartErrorResponse(error)
    }
    generationController = new AbortController()
    registerGenerationController(persistence.generationId, generationController)
    generationObserver = observeGenerationCancellation(
      persistence.generationId,
      generationController
    )
  }

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

    let capturedUsage: FinalizeGenerationUsage | undefined
    let capturedProviderMetadata: unknown
    let modelStreamError: string | undefined
    let abortedUsageUnavailable = false

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
      onError: ({ error }) => {
        modelStreamError =
          error instanceof Error
            ? error.message
            : GENERATION_ERRORS.streamFailed
        console.error("[chat] 模型流错误:", error)
      },
      onAbort: ({ steps }) => {
        if (!persistence) return
        const inputTokens = steps.reduce(
          (total, step) => total + (step.usage.inputTokens ?? 0),
          0
        )
        const outputTokens = steps.reduce(
          (total, step) => total + (step.usage.outputTokens ?? 0),
          0
        )
        const openRouterCostUsd =
          model.provider === "openrouter"
            ? openRouterCostUsdFromSteps(steps)
            : null
        const providerMetadata = steps.at(-1)?.providerMetadata
        const gatewayGenerationId =
          typeof providerMetadata?.gateway?.generationId === "string"
            ? providerMetadata.gateway.generationId
            : null
        if (steps.length > 0) {
          capturedUsage = {
            inputTokens,
            outputTokens,
            costEvidence:
              openRouterCostUsd != null
                ? { source: "openrouter", costUsd: openRouterCostUsd }
                : gatewayGenerationId
                  ? {
                      source: "vercel-gateway",
                      generationId: gatewayGenerationId,
                    }
                  : { source: "estimate" },
          }
          capturedProviderMetadata = providerMetadata
        }
        abortedUsageUnavailable = true
      },
      onEnd: async ({ usage, providerMetadata, steps }) => {
        if (isUnbilledPreview) return
        const providerGenerationId =
          typeof providerMetadata?.gateway?.generationId === "string"
            ? providerMetadata.gateway.generationId
            : null
        const openRouterCostUsd =
          model.provider === "openrouter"
            ? openRouterCostUsdFromSteps(steps)
            : null
        if (model.provider === "openrouter" && openRouterCostUsd == null) {
          console.warn(
            `[chat] OpenRouter 成本元数据不完整，使用静态估值：${model.id}`
          )
        }
        const costEvidence =
          openRouterCostUsd != null
            ? ({ source: "openrouter", costUsd: openRouterCostUsd } as const)
            : providerGenerationId
              ? ({
                  source: "vercel-gateway",
                  generationId: providerGenerationId,
                } as const)
              : ({ source: "estimate" } as const)
        if (persistence) {
          capturedUsage = {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            costEvidence,
          }
          capturedProviderMetadata = providerMetadata
          return
        }
        await chargeUsage({
          userId,
          model: modelId,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          threadId: linearThreadId ?? null,
          costEvidence,
        })
      },
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
        ? async ({ responseMessage, isAborted, finishReason }) => {
            const failedWithoutFinish =
              finishReason == null && modelStreamError !== undefined
            const requestedTerminal = isAborted
              ? "stopped"
              : failedWithoutFinish
                ? "failed"
                : "completed"
            const projected = projectGenerationResult({
              generationId: persistence.generationId,
              threadId: persistence.threadId,
              assistantMessageId: persistence.assistantMessageId,
              responseMessage,
              terminalStatus: requestedTerminal,
              error: modelStreamError,
              researchRoute,
              researchPlan: researchPlan ?? undefined,
              usage: capturedUsage
                ? {
                    inputTokens: capturedUsage.inputTokens,
                    outputTokens: capturedUsage.outputTokens,
                    totalTokens:
                      capturedUsage.inputTokens + capturedUsage.outputTokens,
                    providerMetadata: capturedProviderMetadata,
                  }
                : undefined,
            })
            const outcome =
              requestedTerminal === "completed" &&
              !projected.hasDisplayableOutput
                ? "failed"
                : requestedTerminal
            await finalizeGenerationWithRetry({
              generationId: persistence.generationId,
              outcome,
              result: projected.result,
              error: projected.result.error ?? modelStreamError,
              usage: isUnbilledPreview ? undefined : capturedUsage,
              usageUnavailable:
                !isUnbilledPreview &&
                (abortedUsageUnavailable ||
                  (requestedTerminal !== "completed" && !capturedUsage)),
            })
          }
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
      const projected = projectGenerationResult({
        generationId: persistence.generationId,
        threadId: persistence.threadId,
        assistantMessageId: persistence.assistantMessageId,
        responseMessage: { parts: [] },
        terminalStatus: "failed",
        error:
          error instanceof Error
            ? error.message
            : GENERATION_ERRORS.streamFailed,
      })
      try {
        await finalizeGenerationWithRetry({
          generationId: persistence.generationId,
          outcome: "failed",
          result: projected.result,
          error: projected.result.error,
          usageUnavailable: !isUnbilledPreview,
        })
      } catch (finalizeError) {
        console.error(
          "[thread-chat-generation] 请求初始化失败后的终态保存失败",
          { generationId: persistence.generationId, finalizeError }
        )
      }
    }
    console.error("[chat] 请求初始化失败", error)
    return Response.json({ error: "生成初始化失败，请重试。" }, { status: 500 })
  }
}
