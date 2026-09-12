import { tool } from "ai"
import { z } from "zod"
import { webSearch, webFetch } from "@/lib/ai/search"
import { createWebBudget, webContentBudgetExceeded, normalizeWebUrl, WebAccessError, webFailure, type WebBudget, type WebToolResult } from "@/lib/ai/web-access"
import { createResearchDocuments } from "@/lib/chat/research-documents"
import { WEB_SEARCH_RESPONSE_CHAR_LIMIT, SEARCH_MAX_RESULTS } from "@/constants/research"

type ResearchToolContext = { routeReason?: string; budget?: WebBudget }

/** 每次生成创建一次；失败缓存与在途合并不会跨生成或用户共享。 */
export function createResearchTools(context: ResearchToolContext = {}) {
  const budget = context.budget ?? createWebBudget()
  const documents = createResearchDocuments(budget)
  const failures = new Map<string, WebToolResult<never>>()
  const pending = new Map<string, Promise<WebToolResult<unknown>>>()
  async function run<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<WebToolResult<T>> {
    signal?.throwIfAborted()
    const inflight = pending.get(key)
    if (inflight) {
      const result = await inflight as WebToolResult<T>
      signal?.throwIfAborted()
      if (result.ok) {
        try { budget.spendContent(JSON.stringify(result.data).length) }
        catch (error) {
          if (!(error instanceof WebAccessError)) throw error
          return webFailure(error)
        }
      }
      return result
    }
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
        const selected: typeof results = []
        for (const result of results) {
          if (JSON.stringify({ query, results: [...selected, result] }).length > Math.min(WEB_SEARCH_RESPONSE_CHAR_LIMIT, budget.remainingChars)) continue
          selected.push(result)
        }
        if (!selected.length) {
          if (budget.remainingChars < WEB_SEARCH_RESPONSE_CHAR_LIMIT) throw webContentBudgetExceeded()
          throw new WebAccessError("SEARCH_RESULT_TOO_LARGE", "检索条目过长，请缩小检索范围。", "revise_query")
        }
        const data = { query, results: selected }
        budget.spendContent(JSON.stringify(data).length)
        return data
      }),
    }),
    readUrl: tool({
      description: "读取公开网页。长文档按页返回；hasMore=true 时传入原 URL 和 nextCursor 继续同一快照，不会重复抓取。全文任务请读至末尾，取证任务证据足够即可停止。totalChars 是抽取快照长度，不保证原网页完整。游标仅本次生成有效。ok=false 不是正文；不向用户复述内部参数。",
      inputSchema: z.object({ url: z.string().describe("公开网页 URL"), cursor: z.string().nullish().describe("同一 URL 上次返回的 nextCursor；首次读取省略") }),
      execute: async ({ url, cursor }, { abortSignal }) => {
        abortSignal?.throwIfAborted()
        const readCursor = cursor?.trim() || undefined
        let normalized: string
        try { normalized = normalizeWebUrl(url) } catch (error) {
          if (!(error instanceof WebAccessError)) throw error
          return webFailure(error)
        }
        return run(`fetch:${normalized}:${readCursor ?? "first"}`, abortSignal, () =>
          documents.read(normalized, readCursor, abortSignal, () => webFetch(normalized, { signal: abortSignal, budget, routeReason: context.routeReason })))
      },
    }),
  }
}
