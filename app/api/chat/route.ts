import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { convertToModelMessages, streamText, type UIMessage } from "ai"

export const maxDuration = 30

const minimax = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1",
  apiKey: process.env.MINIMAX_API_KEY,
})

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: minimax(process.env.LLM_MODEL_ID ?? "MiniMax-M2"),
    messages: await convertToModelMessages(messages),
  })

  return result.toUIMessageStreamResponse()
}
