import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  convertToModelMessages,
  extractReasoningMiddleware,
  isStepCount,
  streamText,
  tool,
  wrapLanguageModel,
  type UIMessage,
} from "ai"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import type { ToolJSONSchema } from "assistant-stream"
import { z } from "zod"

export const maxDuration = 30

const minimaxProvider = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
  apiKey: process.env.MINIMAX_API_KEY,
})

// MiniMax emits its reasoning as plain <think>...</think> text rather than a
// dedicated reasoning stream part; extract it so the UI renders it as
// collapsible reasoning instead of literal text.
const minimax = (modelId: string) =>
  wrapLanguageModel({
    model: minimaxProvider(modelId),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  })

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

  const result = streamText({
    model: minimax(process.env.LLM_MODEL_ID ?? "MiniMax-M2"),
    messages: await convertToModelMessages(messages, { tools: allTools }),
    tools: allTools,
    stopWhen: isStepCount(5),
  })

  return result.toUIMessageStreamResponse()
}
