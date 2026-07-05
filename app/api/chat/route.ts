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

export const maxDuration = 30

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
  }: { messages: UIMessage[]; tools?: Record<string, ToolJSONSchema> } = await req.json()

  const allTools = {
    getWeather,
    compareTable,
    ...frontendTools(tools ?? {}),
  }

  // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
  const resolvedMessages = await resolveAttachmentParts(messages)

  const result = streamText({
    model: minimaxChatModel(),
    messages: await convertToModelMessages(resolvedMessages, { tools: allTools }),
    tools: allTools,
    stopWhen: isStepCount(5),
  })

  return result.toUIMessageStreamResponse()
}
