import { tool } from "ai"
import { z } from "zod"
import { webSearch, webFetch } from "@/lib/ai/search"
import { createWebBudget, webBudgetExceeded, normalizeWebUrl, WebAccessError, webFailure, type WebBudget, type WebToolResult } from "@/lib/ai/web-access"
import { EXTRACT_CHAR_LIMIT, SEARCH_MAX_RESULTS } from "@/constants/research"

type ResearchToolContext = { routeReason?: string; budget?: WebBudget }

/** 每次生成创建一次；失败缓存与在途合并不会跨生成或用户共享。 */
export function createResearchTools(context: ResearchToolContext = {}) {
  const budget = context.budget ?? createWebBudget()
  const failures = new Map<string, WebToolResult<never>>()
  const pending = new Map<string, Promise<WebToolResult<unknown>>>()
  async function run<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<WebToolResult<T>> {
    signal?.throwIfAborted()
    const inflight = pending.get(key)
    if (inflight) return inflight as Promise<WebToolResult<T>>
    if (budget.exhausted) return webFailure(webBudgetExceeded())
    const previous = failures.get(key)
    if (previous) return previous
    const request = (async (): Promise<WebToolResult<T>> => {
      try {
        const data = await operation()
        signal?.throwIfAborted()
        return { ok: true, data }
      } catch (error) {
        signal?.throwIfAborted()
        if (!(error instanceof WebAccessError)) throw error
        const failure = webFailure(error)
        if (key.startsWith("search:") && failure.nextAction === "search") failure.nextAction = "revise_query"
        failures.set(key, failure)
        return failure
      }
    })()
    pending.set(key, request)
    try { return await request } finally { pending.delete(key) }
  }
  return {
    webSearch: tool({
      description: "联网核实实时事实，优先官方资料；摘要不足时继续 readUrl。失败时按 nextAction 调整查询，证据充分即停止。",
      inputSchema: z.object({ query: z.string().describe("具体的检索关键词或问题") }),
      execute: async ({ query }, { abortSignal }) => run(`search:${query.trim()}`, abortSignal, async () => {
        if (!query.trim()) throw new WebAccessError("INVALID_QUERY", "请提供有效查询。", "revise_query")
        const { results } = await budget.run(abortSignal, (signal, attemptIndex) =>
          webSearch(query.trim(), SEARCH_MAX_RESULTS, signal, { routeReason: context.routeReason, attemptIndex }))
        if (!results.length) throw new WebAccessError("EMPTY_RESULT", "没有找到有效来源，可调整查询；这不代表目标不存在。", "revise_query")
        return { query, results }
      }),
    }),
    readUrl: tool({
      description: "读取用户指定或搜索得到的网页正文。ok=false 表示未读到正文；truncated=true 表示仅获得部分正文，不可声称读完。",
      inputSchema: z.object({ url: z.string().describe("公开网页 URL") }),
      execute: async ({ url }, { abortSignal }) => {
        abortSignal?.throwIfAborted()
        let normalized: string
        try { normalized = normalizeWebUrl(url) } catch (error) {
          if (!(error instanceof WebAccessError)) throw error
          return webFailure(error)
        }
        return run(`fetch:${normalized}`, abortSignal, async () => {
          const page = await webFetch(normalized, { signal: abortSignal, budget, routeReason: context.routeReason })
          return { ...page, content: page.content.slice(0, EXTRACT_CHAR_LIMIT), truncated: page.content.length > EXTRACT_CHAR_LIMIT }
        })
      },
    }),
  }
}
