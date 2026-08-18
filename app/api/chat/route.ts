import {
  convertToModelMessages,
  isStepCount,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai"
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
  WEB_ACCESS_SYSTEM_PROMPT,
} from "@/constants/research"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import { getCurrentUserId } from "@/lib/auth/server"
import {
  DEFAULT_MODEL_ID,
  getChatModel,
  isUnbilledPreviewModel,
  MAX_OUTPUT_TOKENS,
} from "@/constants/model"
import { resolveChatModel, isModelConfigured } from "@/lib/ai/provider"
import { openRouterCostUsdFromSteps } from "@/lib/ai/openrouter"
import { hasPositiveBalance, chargeUsage } from "@/lib/billing/credits"
import { buildUsageMetadata } from "@/lib/billing/usage-meta"
import {
  isExplicitMarkdownArtifactRequest,
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
  type MarkdownArtifactToolResult,
} from "@/lib/chat/markdown-artifact"

// Tavily 搜索与网页深读可能形成多步循环，放宽单次请求时长上限。
export const maxDuration = 300

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

/** 明确要求联网/访问页面时强制首步搜索，避免模型错误声称自己无法联网。 */
function explicitlyRequestsWebAccess(text: string): boolean {
  const normalized = text.toLowerCase()
  if (/https?:\/\/|www\./i.test(normalized)) return true

  const webTarget =
    /(github|网页|网站|链接|官网|官方文档|社区|文章|新闻|互联网|网络|web|website|url|link|docs?)/i
  const accessIntent =
    /(访问|打开|读取|浏览|搜索|检索|查找|搜一下|看一下|核验|最新|当前|实时|search|browse|open|read|visit|look\s*up|latest|current)/i
  return webTarget.test(normalized) && accessIntent.test(normalized)
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
    modelId: rawModelId,
    id: threadId,
  }: {
    messages: UIMessage[]
    tools?: Record<string, ToolJSONSchema>
    deepResearch?: boolean
    /** thread-chat 分支对话页的模式标记：system 由服务端按锚点原文构造 */
    threadChat?: { anchorText?: string | null }
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

  // Tavily 是当前统一联网层：所有模型都获得相同的搜索与网页深读工具。
  // deepResearch 只控制研究提示强度，不再决定工具是否存在。
  const research = deepResearch === true
  const searchReady = isSearchConfigured()
  const isThreadChat = threadChat != null
  const forceWebSearch =
    searchReady && explicitlyRequestsWebAccess(latestUserText(messages))
  const markdownArtifactRequested =
    isThreadChat &&
    isExplicitMarkdownArtifactRequest(latestUserText(messages))

  const allTools: ToolSet = {
    // 普通 ThreadChat 请求完全不暴露 Markdown 工具，避免模型把长回答误判成产物。
    // 只有明确要求独立文章/文档/文件/Markdown 时才挂载并强制使用。
    ...(isThreadChat
      ? markdownArtifactRequested
        ? { [MARKDOWN_ARTIFACT_TOOL_NAME]: createMarkdownArtifact }
        : {}
      : { getWeather, compareTable }),
    ...(searchReady ? researchTools : {}),
    ...frontendTools(tools ?? {}),
  }

  // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
  const resolvedMessages = await resolveAttachmentParts(messages)

  const system = [
    isThreadChat
      ? buildThreadChatSystem(threadChat.anchorText, {
          enableMarkdownArtifact: markdownArtifactRequested,
        })
      : null,
    searchReady ? WEB_ACCESS_SYSTEM_PROMPT : null,
    research && searchReady ? RESEARCH_SYSTEM_PROMPT : null,
    research && !searchReady
      ? "用户开启了深度研究，但服务端未配置搜索服务（SEARCH_API_KEY），请如实告知该功能暂不可用，并基于已有知识尽力回答。"
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n")

  const result = streamText({
    model: resolveChatModel(modelId),
    system,
    messages: await convertToModelMessages(resolvedMessages, {
      tools: allTools,
    }),
    tools: allTools,
    // 明确 Markdown 交付请求只强制第 0 步启动工具调用；后续步骤仍保留工具，
    // 让模型在用户要求多份独立文档时，为每份文档分别创建一个 Artifact。
    prepareStep:
      isThreadChat || forceWebSearch
        ? ({ stepNumber }) => {
            const activeTools = isThreadChat
              ? [
                  ...(markdownArtifactRequested
                    ? [MARKDOWN_ARTIFACT_TOOL_NAME]
                    : []),
                  ...(searchReady ? ["webSearch", "readUrl"] : []),
                ]
              : undefined

            if (stepNumber === 0 && forceWebSearch) {
              return {
                activeTools,
                toolChoice: { type: "tool" as const, toolName: "webSearch" },
              }
            }
            if (stepNumber === 0 && markdownArtifactRequested) {
              return {
                activeTools,
                toolChoice: {
                  type: "tool" as const,
                  toolName: MARKDOWN_ARTIFACT_TOOL_NAME,
                },
              }
            }
            return activeTools ? { activeTools } : undefined
          }
        : undefined,
    // 单请求输出封顶：收敛并发竞态下的最大超支敞口，并防异常长输出打爆供应商账单
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // 联网模式允许模型反复搜索、深读并综合；20 步只作为异常循环熔断。
    stopWhen: isStepCount(searchReady ? RESEARCH_MAX_STEPS : 5),
    // 4) 已计费模型在生成结束后按 token 用量即时扣费并写入流水。
    //    UMAPIS 预览尚未有经确认的价格，不扣余额也不写流水。
    onEnd: async ({ usage, providerMetadata, steps }) => {
      if (isUnbilledPreview) return
      const generationId =
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
      await chargeUsage({
        userId,
        model: modelId,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        threadId: threadId ?? null,
        costEvidence:
          openRouterCostUsd != null
            ? { source: "openrouter", costUsd: openRouterCostUsd }
            : generationId
              ? { source: "vercel-gateway", generationId }
              : { source: "estimate" },
      })
    },
  })

  // 即使客户端中途断连，也在服务端把整条流消费完，保证 onEnd（计费）必然触发，
  // 避免「已产生供应商成本却漏计费」。after 让 Serverless 保活到消费结束。
  after(async () => {
    try {
      await result.consumeStream()
    } catch {
      // 生成出错时不计费（onEnd 不触发），忽略消费错误即可
    }
  })

  return result.toUIMessageStreamResponse({
    // 流内错误在服务端留日志便于排查；返回值仍是发给客户端的掩码文案（默认行为不变）
    onError: (error) => {
      console.error("[chat] 流内错误:", error)
      return "An error occurred."
    },
    // 把本次用量与费用附到 assistant 消息 metadata，随消息持久化，供输入框下方 token 统计展示
    messageMetadata: ({ part }) =>
      part.type === "finish"
        ? buildUsageMetadata(modelId, part.totalUsage)
        : undefined,
  })
}
