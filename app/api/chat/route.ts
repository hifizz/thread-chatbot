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
import { minimaxChatModel } from "@/lib/ai/minimax"
import { researchTools } from "@/lib/chat/research-tools"
import { isSearchConfigured } from "@/lib/ai/search"
import { RESEARCH_MAX_STEPS, RESEARCH_SYSTEM_PROMPT } from "@/constants/research"

// 深度研究可能多步循环，耗时较长，放宽单次请求时长上限
export const maxDuration = 120

const getWeather = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({
    location: z.string().describe("City name, e.g. 'San Francisco'"),
  }),
  execute: async ({ location }) => {
    // Deterministic mock reading (hashed from the city name) - no real weather API/key involved.
    const conditions = ["Sunny", "Partly Cloudy", "Cloudy", "Light Rain", "Clear"]
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
    columns: z.array(z.string()).describe("Category labels, e.g. country names"),
    series: z.array(
      z.object({
        name: z.string(),
        values: z.array(z.number()).describe("One value per column, same order as columns"),
      }),
    ),
  }),
  execute: async (input) => input,
})

export async function POST(req: Request) {
  const {
    messages,
    tools,
    deepResearch,
  }: {
    messages: UIMessage[]
    tools?: Record<string, ToolJSONSchema>
    deepResearch?: boolean
  } = await req.json()

  // 研究模式：加入联网检索/深读工具、放宽步数、注入研究系统提示
  const research = deepResearch === true
  const searchReady = isSearchConfigured()

  const allTools = {
    getWeather,
    compareTable,
    ...(research && searchReady ? researchTools : {}),
    ...frontendTools(tools ?? {}),
  }

  // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
  const resolvedMessages = await resolveAttachmentParts(messages)

  const system = research
    ? searchReady
      ? RESEARCH_SYSTEM_PROMPT
      : "用户开启了深度研究，但服务端未配置搜索服务（SEARCH_API_KEY），请如实告知该功能暂不可用，并基于已有知识尽力回答。"
    : undefined

  const result = streamText({
    model: minimaxChatModel(),
    system,
    messages: await convertToModelMessages(resolvedMessages, { tools: allTools }),
    tools: allTools,
    // 研究模式允许更多工具轮次；普通对话维持原来的小步数
    stopWhen: isStepCount(research && searchReady ? RESEARCH_MAX_STEPS : 5),
  })

  return result.toUIMessageStreamResponse()
}
