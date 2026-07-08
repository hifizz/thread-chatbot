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
import {
  RESEARCH_MAX_STEPS,
  RESEARCH_SYSTEM_PROMPT,
} from "@/constants/research"
import {
  CHAT_MAX_OUTPUT_TOKENS,
  DEMO_MAX_FILES,
  WORKBENCH_SYSTEM_PROMPT,
} from "@/constants/workbench"

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

// 生成式 Demo：代码本体通过 args 流式传给前端工作台（Sandpack 预览），
// execute 只回一个轻量确认，避免大段代码在 tool result 里往返一遍。
const createDemo = tool({
  description:
    "创建或整体更新一个可实时预览的 React Demo 项目。用户要求编写/演示 React 组件、页面、动效或 UI Demo 时调用；更新已有 Demo 时输出全部文件的完整最新内容。",
  inputSchema: z.object({
    title: z.string().describe("Demo 的简短中文标题；更新已有 Demo 时保持不变"),
    files: z
      .array(
        z.object({
          path: z.string().describe("以 / 开头的文件路径，入口必须是 /App.tsx"),
          content: z.string().describe("该文件的完整源码"),
        })
      )
      .min(1)
      .max(DEMO_MAX_FILES),
    dependencies: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        '预装依赖之外需要的 npm 包，如 {"@radix-ui/react-dialog":"latest"}'
      ),
  }),
  execute: async ({ title, files }) => ({
    ok: true,
    title,
    fileCount: files.length,
    note: "Demo 已在用户右侧的代码工作台中打开并展示预览",
  }),
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
    createDemo,
    ...(research && searchReady ? researchTools : {}),
    ...frontendTools(tools ?? {}),
  }

  // MiniMax 不接受 file part：先把附件（PDF→提取文本，其余→占位说明）转换为 text part
  const resolvedMessages = await resolveAttachmentParts(messages)

  // 研究模式保持研究提示词纯净；普通对话注入代码工作台指引
  const system = research
    ? searchReady
      ? RESEARCH_SYSTEM_PROMPT
      : "用户开启了深度研究，但服务端未配置搜索服务（SEARCH_API_KEY），请如实告知该功能暂不可用，并基于已有知识尽力回答。"
    : WORKBENCH_SYSTEM_PROMPT

  const result = streamText({
    model: minimaxChatModel(),
    system,
    messages: await convertToModelMessages(resolvedMessages, {
      tools: allTools,
    }),
    tools: allTools,
    // 多文件 Demo 代码量大，MiniMax 默认 max_tokens 不够用，统一放宽
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    // 研究模式允许更多工具轮次；普通对话维持原来的小步数
    stopWhen: isStepCount(research && searchReady ? RESEARCH_MAX_STEPS : 5),
  })

  return result.toUIMessageStreamResponse()
}
