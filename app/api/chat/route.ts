import {
  convertToModelMessages,
  isStepCount,
  streamText,
  tool,
  type UIMessage,
} from "ai"
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
import { getChatModel, resolveModelId } from "@/constants/model"
import { resolveChatModel, isModelConfigured } from "@/lib/ai/provider"
import { hasPositiveBalance, chargeUsage } from "@/lib/billing/credits"
import { buildUsageMetadata } from "@/lib/billing/usage-meta"

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
    modelId?: string
    id?: string
  } = await req.json()

  // 2) 解析并校验所选模型
  const modelId = resolveModelId(rawModelId)
  const model = getChatModel(modelId)!
  if (!isModelConfigured(model)) {
    return Response.json(
      {
        error: `模型「${model.name}」未配置，请联系管理员在服务端配置对应 API Key 或 CF AI 网关。`,
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

  const allTools = {
    // thread-chat 模式不挂后端工具：该页面是分支讲解对话，直接不给工具比在 prompt 里劝阻更可靠
    ...(isThreadChat ? {} : { getWeather, compareTable }),
    ...(research && searchReady ? researchTools : {}),
    ...frontendTools(tools ?? {}),
  }

  // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
  const resolvedMessages = await resolveAttachmentParts(messages)

  const system = research
    ? searchReady
      ? RESEARCH_SYSTEM_PROMPT
      : "用户开启了深度研究，但服务端未配置搜索服务（SEARCH_API_KEY），请如实告知该功能暂不可用，并基于已有知识尽力回答。"
    : isThreadChat
      ? buildThreadChatSystem(threadChat.anchorText)
      : undefined

  const result = streamText({
    model: resolveChatModel(modelId),
    system,
    messages: await convertToModelMessages(resolvedMessages, {
      tools: allTools,
    }),
    tools: allTools,
    // 研究模式允许更多工具轮次；普通对话维持原来的小步数
    stopWhen: isStepCount(research && searchReady ? RESEARCH_MAX_STEPS : 5),
    // 4) 生成结束后按 token 用量即时扣费并写入流水（价目表估算，利润率 ≥30%）。
    //    若经 Vercel 网关，采集 generationId，稍后由 /api/billing/reconcile 拉真实成本对账。
    onFinish: async ({ usage, providerMetadata }) => {
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
        generationId,
      })
    },
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
