import {
  convertToModelMessages,
  isStepCount,
  streamText,
  tool,
  type UIMessage,
} from "ai"
import { after } from "next/server"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import type { ToolJSONSchema } from "assistant-stream"
import {
  getActiveTraceId,
  propagateAttributes,
  startActiveObservation,
  type LangfuseSpan,
} from "@langfuse/tracing"
import { z } from "zod"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import { minimaxChatModel } from "@/lib/ai/minimax"
import { researchTools } from "@/lib/chat/research-tools"
import { isSearchConfigured } from "@/lib/ai/search"
import {
  flushLangfuseSpans,
  isLangfuseConfigured,
  isValidTraceId,
} from "@/lib/observability/langfuse"
import {
  CHAT_TRACE_NAME,
  TELEMETRY_FUNCTION_IDS,
  TRACE_TAGS,
} from "@/constants/observability"
import {
  RESEARCH_MAX_STEPS,
  RESEARCH_SYSTEM_PROMPT,
} from "@/constants/research"

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

type ChatRequestBody = {
  messages: UIMessage[]
  tools?: Record<string, ToolJSONSchema>
  deepResearch?: boolean
  /** useChat 的 chat id == assistant-ui threadListItem.id == threads.id */
  id?: string
}

/** trace 根观测的 input 记录最后一条用户消息的纯文本（完整 prompt 在 generation 观测里已有） */
function lastUserText(messages: UIMessage[]): string {
  const lastUser = messages.findLast((m) => m.role === "user")
  if (!lastUser) return ""
  return lastUser.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
}

async function runChat(
  body: ChatRequestBody,
  turn?: LangfuseSpan
): Promise<Response> {
  const { messages, tools, deepResearch } = body

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

  turn?.update({ input: lastUserText(messages) })

  const result = streamText({
    model: minimaxChatModel(),
    system,
    messages: await convertToModelMessages(resolvedMessages, {
      tools: allTools,
    }),
    tools: allTools,
    // 研究模式允许更多工具轮次；普通对话维持原来的小步数
    stopWhen: isStepCount(research && searchReady ? RESEARCH_MAX_STEPS : 5),
    telemetry: { functionId: TELEMETRY_FUNCTION_IDS.chat },
    // handler 返回后流仍在继续，根观测在流真正结束/出错/中止时才收尾
    ...(turn && {
      onEnd: ({ text }) => {
        turn.update({ output: text }).end()
      },
      onError: ({ error }) => {
        turn
          .update({
            level: "ERROR",
            statusMessage:
              error instanceof Error ? error.message : String(error),
          })
          .end()
      },
      onAbort: () => {
        turn.update({ statusMessage: "aborted by client" }).end()
      },
    }),
  })

  // serverless 下函数在响应后可能立刻冻结，响应结束后冲刷 span 批次
  if (turn) after(() => flushLangfuseSpans())

  // 服务端把 traceId 下发为 assistant 消息 id：前端点赞/点踩时直接以消息 id 回写 score，
  // 无需另建 message↔trace 映射。未启用遥测（或拿到无效 traceId）时交回 AI SDK 默认生成。
  const traceId = getActiveTraceId()
  return result.toUIMessageStreamResponse({
    ...(traceId &&
      isValidTraceId(traceId) && { generateMessageId: () => traceId }),
  })
}

export async function POST(req: Request) {
  const body: ChatRequestBody = await req.json()

  if (!isLangfuseConfigured()) return runChat(body)

  return startActiveObservation(
    CHAT_TRACE_NAME,
    (turn) =>
      propagateAttributes(
        {
          traceName: CHAT_TRACE_NAME,
          // threadId 作为 sessionId，同一线程的多轮对话在 Langfuse 里聚成一个 session
          sessionId: body.id,
          tags: [
            body.deepResearch === true
              ? TRACE_TAGS.deepResearch
              : TRACE_TAGS.chat,
          ],
        },
        () => runChat(body, turn)
      ),
    // 流式响应在 handler 返回后才结束，span 由 onEnd/onError/onAbort 收尾
    { endOnExit: false }
  )
}
