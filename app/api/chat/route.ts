import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  tool,
  type ToolSet,
  type ToolCallRepairFunction,
  type UIMessage,
} from "ai"
import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import type { ToolJSONSchema } from "assistant-stream"
import { z } from "zod"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import { researchTools } from "@/lib/chat/research-tools"
import { isSearchConfigured } from "@/lib/ai/search"
import {
  RESEARCH_MAX_STEPS,
  RESEARCH_SYSTEM_PROMPT,
} from "@/constants/research"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import { getCurrentUserId } from "@/lib/auth/server"
import {
  DEFAULT_MODEL_ID,
  getChatModel,
  MAX_OUTPUT_TOKENS,
} from "@/constants/model"
import { resolveChatModel, isModelConfigured } from "@/lib/ai/provider"
import { hasPositiveBalance, chargeUsage } from "@/lib/billing/credits"
import {
  chargeExternalUsage,
  type ExternalUsageStatus,
} from "@/lib/billing/credits"
import {
  buildUsageMetadata,
  createExternalUsageAccumulator,
} from "@/lib/billing/usage-meta"
import {
  AUTO_WEB_SEARCH_OPERATION,
  AUTO_WEB_SEARCH_PROVIDER,
  AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT,
  AUTO_WEB_SEARCH_TOOL_NAME,
  DEFAULT_WEB_SEARCH_MODE,
  THREAD_CHAT_MAX_STEPS,
  WEB_SEARCH_MODES,
  type WebSearchMode,
} from "@/constants/web-search"
import {
  createAutoWebSearchBudget,
  createAutoWebSearchTool,
  repairAutoWebSearchToolCall,
  resolveAutoWebSearchFeature,
  resolveAutoWebSearchRuntimeLimits,
  type AutoWebSearchStatus,
} from "@/lib/chat/auto-web-search"
import { buildThreadChatStepPolicy } from "@/lib/chat/thread-chat-tool-policy"
import { appendServerForcedSearchResult } from "@/lib/chat/server-forced-search"
import {
  createSourceUrlGuardTransform,
  type SourceUrlGuardState,
} from "@/lib/chat/source-url-guard"
import {
  isExplicitMarkdownDeliverableRequest,
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
  type MarkdownArtifactToolResult,
} from "@/lib/chat/markdown-artifact"

// 深度研究可能多步循环，耗时较长，放宽单次请求时长上限
export const maxDuration = 120

const getWeather = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({
    location: z.string().describe("City name, e.g. 'San Francisco'"),
  }),
  execute: async ({ location }) => {
    // Deterministic mock reading (hashed from the city name) - no real weather API/key involved.
    const conditions = [
      "Sunny",
      "Partly Cloudy",
      "Cloudy",
      "Light Rain",
      "Clear",
    ]
    const seed = [...location].reduce((acc, c) => acc + c.charCodeAt(0), 0)
    return {
      location,
      temperatureF: 55 + (seed % 35),
      condition: conditions[seed % conditions.length],
      humidity: 30 + (seed % 50),
      asOf: new Date().toISOString(),
    }
  },
})

const compareTable = tool({
  description:
    "Render a comparison table for two or more items across one or more numeric metrics. Use whenever the user asks to compare things 'in a table' with real numeric data.",
  inputSchema: z.object({
    title: z.string(),
    unit: z.string().optional(),
    columns: z
      .array(z.string())
      .describe("Category labels, e.g. country names"),
    series: z.array(
      z.object({
        name: z.string(),
        values: z
          .array(z.number())
          .describe("One value per column, same order as columns"),
      })
    ),
  }),
  execute: async (input) => input,
})

const createMarkdownArtifact = tool({
  description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  inputSchema: markdownArtifactInputSchema,
  execute: async (): Promise<MarkdownArtifactToolResult> => ({ created: true }),
})

/** 只看最后一条 user 消息的文本 part，供高置信首步强制路由。 */
function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "user") continue
    return message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
  }
  return ""
}

function isWebSearchMode(value: unknown): value is WebSearchMode {
  return WEB_SEARCH_MODES.some((mode) => mode === value)
}

function externalUsageStatus(status: AutoWebSearchStatus): ExternalUsageStatus {
  switch (status) {
    case "success":
      return "succeeded"
    case "timeout":
      return "timeout"
    case "rate_limited":
      return "rate_limited"
    case "empty_results":
      return "empty"
    case "all_results_filtered":
      return "filtered"
    case "invalid_response":
    case "provider_error":
      return "provider_error"
    default:
      return "failed"
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  )
}

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
    webSearchMode: rawWebSearchMode,
    modelId: rawModelId,
    id: threadId,
  }: {
    messages: UIMessage[]
    tools?: Record<string, ToolJSONSchema>
    deepResearch?: boolean
    /** thread-chat 分支对话页的模式标记：system 由服务端按锚点原文构造 */
    threadChat?: { anchorText?: string | null }
    webSearchMode?: unknown
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
  const modelId =
    typeof rawModelId === "string" ? rawModelId : DEFAULT_MODEL_ID
  const model = getChatModel(modelId)!
  if (!isModelConfigured(model)) {
    return Response.json(
      {
        error: `模型「${model.name}」未配置，请联系管理员在服务端配置对应 API Key 或可用网关。`,
      },
      { status: 400 }
    )
  }

  // 3) 计费拦截：余额不足不允许发起新对话
  if (!(await hasPositiveBalance(userId))) {
    return Response.json({ error: "额度不足，请充值后再试。" }, { status: 402 })
  }

  // 研究模式：加入联网检索/深读工具、放宽步数、注入研究系统提示
  const research = deepResearch === true
  const searchReady = isSearchConfigured()
  // thread-chat 模式：结构化风格 system + 不挂后端工具（研究模式优先级更高）
  const isThreadChat = !research && threadChat != null
  if (
    isThreadChat &&
    rawWebSearchMode !== undefined &&
    !isWebSearchMode(rawWebSearchMode)
  ) {
    return Response.json(
      { error: "Web Search 模式必须是 auto、always 或 off。" },
      { status: 400 }
    )
  }
  const webSearchMode = isThreadChat
    ? isWebSearchMode(rawWebSearchMode)
      ? rawWebSearchMode
      : DEFAULT_WEB_SEARCH_MODE
    : "off"
  const autoSearchFeature = resolveAutoWebSearchFeature({ subjectId: userId })
  const autoSearchEnabled =
    isThreadChat &&
    webSearchMode !== "off" &&
    autoSearchFeature.enabled &&
    searchReady
  const forceMarkdownArtifact =
    isThreadChat &&
    isExplicitMarkdownDeliverableRequest(latestUserText(messages))
  const autoSearchRuntimeLimits = resolveAutoWebSearchRuntimeLimits()
  const threadChatMaxSteps =
    webSearchMode === "always"
      ? THREAD_CHAT_MAX_STEPS
      : autoSearchRuntimeLimits.maxSteps

  const requestId = randomUUID()
  const responseId = randomUUID()
  // always 的首搜已经由服务端完成；后续仅保留 schema 以把 GLM 的重复 tool call
  // 降级为 budget_exhausted，绝不再产生第二次 provider 请求。
  const searchBudget = createAutoWebSearchBudget(
    isThreadChat && webSearchMode === "always"
      ? 1
      : autoSearchRuntimeLimits.maxCalls,
    autoSearchRuntimeLimits.maxCalls
  )
  const externalUsage = createExternalUsageAccumulator()
  const sourceUrlGuard: SourceUrlGuardState = {
    active: false,
    allowedUrls: new Set(),
    sources: new Map(),
  }
  const autoSearchTool = createAutoWebSearchTool({
    budget: searchBudget,
    onResult: (results) => {
      sourceUrlGuard.active = true
      for (const result of results) {
        sourceUrlGuard.allowedUrls.add(result.url)
        sourceUrlGuard.sources.set(result.url, result.title)
      }
    },
    onProviderAttempt: async (attempt) => {
      sourceUrlGuard.active = true
      const charge = await chargeExternalUsage({
        userId,
        threadId: threadId ?? null,
        responseId,
        requestId,
        callIndex: attempt.callIndex,
        provider: AUTO_WEB_SEARCH_PROVIDER,
        operation: AUTO_WEB_SEARCH_OPERATION,
        status: externalUsageStatus(attempt.status),
        billableUnits: Math.max(0, Math.ceil(attempt.billableUnits)),
        latencyMs: attempt.latencyMs,
        resultCount: attempt.resultCount,
        queryFingerprint: attempt.queryFingerprint,
      })
      externalUsage.record({
        callIndex: attempt.callIndex,
        billableUnits: Math.max(0, Math.ceil(attempt.billableUnits)),
        costMicros: charge.costMicros,
        priceMicros: charge.priceMicros,
      })
    },
  })

  const allTools: ToolSet = {
    // ThreadChat 只挂 Markdown 交付工具；线性聊天继续使用原有演示工具。
    ...(isThreadChat
      ? { [MARKDOWN_ARTIFACT_TOOL_NAME]: createMarkdownArtifact }
      : { getWeather, compareTable }),
    ...(research && searchReady ? researchTools : {}),
    ...(autoSearchEnabled
      ? { [AUTO_WEB_SEARCH_TOOL_NAME]: autoSearchTool }
      : {}),
    ...frontendTools(tools ?? {}),
  }

  // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
  const resolvedMessages = await resolveAttachmentParts(messages)

  const system = research
    ? searchReady
      ? RESEARCH_SYSTEM_PROMPT
      : "用户开启了深度研究，但服务端未配置搜索服务（SEARCH_API_KEY），请如实告知该功能暂不可用，并基于已有知识尽力回答。"
    : isThreadChat
      ? buildThreadChatSystem(threadChat.anchorText, {
          enabled: autoSearchEnabled,
          mode: webSearchMode,
        })
      : undefined

  const modelMessages = await convertToModelMessages(resolvedMessages, {
    tools: allTools,
  })
  const onGenerationFinish = async ({
    usage,
    providerMetadata,
  }: {
    usage: { inputTokens?: number; outputTokens?: number }
    providerMetadata?: Record<string, Record<string, unknown>>
  }) => {
    const generationId =
      typeof providerMetadata?.gateway?.generationId === "string"
        ? providerMetadata.gateway.generationId
        : null
    await chargeUsage({
      userId,
      model: modelId,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      threadId: threadId ?? null,
      messageId: responseId,
      generationId,
    })
  }
  const messageMetadata = ({ part }: { part: { type: string; totalUsage?: unknown } }) =>
    part.type === "finish" && part.totalUsage
      ? buildUsageMetadata(
          modelId,
          part.totalUsage as {
            inputTokens?: number
            outputTokens?: number
            totalTokens?: number
          },
          externalUsage.snapshot()
        )
      : undefined
  const onStreamError = (error: unknown) => {
    console.error("[chat] 流内错误:", error)
    return "An error occurred."
  }

  /**
   * Ark GLM-5.2 实测会忽略 forced tool_choice。always 因此由服务端在首个模型
   * step 之前确定性执行一次搜索，再把真实 tool call/result 注入模型上下文。
   */
  if (isThreadChat && webSearchMode === "always" && autoSearchEnabled) {
    const toolCallId = `always_${randomUUID()}`
    const query = (
      latestUserText(resolvedMessages).trim() ||
      "Verify the user's latest request with current public sources"
    ).slice(0, AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT)
    const stream = createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        writer.write({
          type: "tool-input-start",
          toolCallId,
          toolName: AUTO_WEB_SEARCH_TOOL_NAME,
        })
        writer.write({
          type: "tool-input-available",
          toolCallId,
          toolName: AUTO_WEB_SEARCH_TOOL_NAME,
          input: { query },
        })

        const executeSearch = autoSearchTool.execute
        if (!executeSearch) throw new Error("Auto Web Search 工具缺少执行器")
        const searchOutput = await executeSearch(
          { query },
          {
            toolCallId,
            messages: modelMessages,
            abortSignal: req.signal,
            context: undefined as never,
          }
        )
        if (isAsyncIterable(searchOutput)) {
          throw new Error("Auto Web Search 不应返回异步迭代器")
        }
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output: searchOutput,
        })

        const seededMessages = appendServerForcedSearchResult({
          messages: modelMessages,
          toolCallId,
          toolName: AUTO_WEB_SEARCH_TOOL_NAME,
          query,
          output: searchOutput,
        })

        const result = streamText({
          model: resolveChatModel(modelId),
          system: buildThreadChatSystem(threadChat.anchorText, {
            enabled: true,
            mode: "always",
            forcedSearchCompleted: true,
          }),
          messages: seededMessages,
          tools: allTools,
          prepareStep: ({ stepNumber, steps }) => {
            return buildThreadChatStepPolicy({
              stepNumber,
              // 首次搜索已经由服务端完成，后续恢复自动决策，不能再次强制。
              searchMode: "auto",
              searchEnabled: false,
              searchBudgetRemaining: 0,
              forceMarkdownArtifact,
              calledToolNames: [
                AUTO_WEB_SEARCH_TOOL_NAME,
                ...steps.flatMap((step) =>
                  step.toolCalls.map((call) => call.toolName)
                ),
              ],
              markdownArtifactToolName: MARKDOWN_ARTIFACT_TOOL_NAME,
              webSearchToolName: AUTO_WEB_SEARCH_TOOL_NAME,
            })
          },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          stopWhen: isStepCount(threadChatMaxSteps),
          experimental_transform: createSourceUrlGuardTransform(sourceUrlGuard),
          onFinish: onGenerationFinish,
        })
        writer.merge(
          result.toUIMessageStream({ messageMetadata, onError: onStreamError })
        )
      },
      onError: onStreamError,
    })
    return createUIMessageStreamResponse({ stream })
  }

  const result = streamText({
    model: resolveChatModel(modelId),
    system,
    messages: modelMessages,
    tools: allTools,
    // 高置信 Markdown 交付请求只强制第 0 步启动工具调用；后续步骤仍保留工具，
    // 让模型在用户要求多份独立文档时，为每份文档分别创建一个 Artifact。
    prepareStep: isThreadChat
      ? ({ stepNumber, steps }) => {
          searchBudget.beginStep()
          return buildThreadChatStepPolicy({
            stepNumber,
            searchMode: webSearchMode,
            searchEnabled: autoSearchEnabled,
            searchBudgetRemaining: searchBudget.remaining,
            forceMarkdownArtifact,
            calledToolNames: steps.flatMap((step) =>
              step.toolCalls.map((call) => call.toolName)
            ),
            markdownArtifactToolName: MARKDOWN_ARTIFACT_TOOL_NAME,
            webSearchToolName: AUTO_WEB_SEARCH_TOOL_NAME,
          })
        }
      : undefined,
    experimental_repairToolCall: autoSearchEnabled
      ? (repairAutoWebSearchToolCall as ToolCallRepairFunction<ToolSet>)
      : undefined,
    // 单请求输出封顶：收敛并发竞态下的最大超支敞口，并防异常长输出打爆供应商账单
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    experimental_transform: createSourceUrlGuardTransform(sourceUrlGuard),
    // Thread Chat 最多允许 5 步工具交互，既支持一次交付多份 Markdown 文件，
    // 也限制异常循环；其它模式继续沿用既有步数上限。
    stopWhen: isThreadChat
      ? isStepCount(threadChatMaxSteps)
      : isStepCount(research && searchReady ? RESEARCH_MAX_STEPS : 5),
    // 4) 生成结束后按 token 用量即时扣费并写入流水（价目表估算，利润率 ≥30%）。
    //    若经 Vercel 网关，采集 generationId，稍后由 /api/billing/reconcile 拉真实成本对账。
    onFinish: onGenerationFinish,
  })

  // 即使客户端中途断连，也在服务端把整条流消费完，保证 onFinish（计费）必然触发，
  // 避免「已产生供应商成本却漏计费」。after 让 Serverless 保活到消费结束。
  after(async () => {
    try {
      await result.consumeStream()
    } catch {
      // 生成出错时不计费（onFinish 不触发），忽略消费错误即可
    }
  })

  return result.toUIMessageStreamResponse({
    // 流内错误在服务端留日志便于排查；返回值仍是发给客户端的掩码文案（默认行为不变）
    onError: onStreamError,
    // 把本次用量与费用附到 assistant 消息 metadata，随消息持久化，供输入框下方 token 统计展示
    messageMetadata,
  })
}
