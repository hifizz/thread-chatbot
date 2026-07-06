import { tool } from "ai"
import { z } from "zod"
import { webSearch, extractUrl } from "@/lib/ai/search"
import { EXTRACT_CHAR_LIMIT, SEARCH_MAX_RESULTS } from "@/constants/research"

// 深度研究的后端工具：联网搜索 + 网页深读。工具调用与结果会在 assistant-ui 里渲染，
// 天然提供「研究过程可见」；模型据搜索/深读结果多步推进，最终综合成带引用的报告。

export const webSearchTool = tool({
  description:
    "联网搜索以获取实时或事实性信息。用于回答需要最新资料、外部知识的问题。可多次调用以覆盖不同子问题。",
  inputSchema: z.object({
    query: z.string().describe("检索关键词或问题，尽量具体"),
  }),
  execute: async ({ query }) => {
    const { answer, results } = await webSearch(query, SEARCH_MAX_RESULTS)
    // 返回给模型的结构：带 url 的结果列表，供其继续深读或引用
    return {
      query,
      answer,
      results: results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
    }
  },
})

export const readUrlTool = tool({
  description:
    "深读某个网页的完整正文。当搜索快照不足以回答、需要页面细节时，用搜索结果里的 url 调用。",
  inputSchema: z.object({
    url: z.string().describe("要深读的网页 URL（来自搜索结果）"),
  }),
  execute: async ({ url }) => {
    const content = await extractUrl(url)
    return { url, content: content.slice(0, EXTRACT_CHAR_LIMIT) }
  },
})

export const researchTools = {
  webSearch: webSearchTool,
  readUrl: readUrlTool,
}
