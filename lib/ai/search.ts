import {
  ANYSEARCH_CLIENT_HEADER,
  ANYSEARCH_MCP_API_URL,
  ANYSEARCH_PROVIDER_NAME,
  ANYSEARCH_REQUEST_TIMEOUT_MS,
  ANYSEARCH_SEARCH_API_URL,
  ANYSEARCH_SEARCH_RESULT_CHAR_LIMIT,
  ANYSEARCH_SEARCH_RESULT_LIMIT,
} from "@/constants/research"
import { runProviderAttempt } from "@/lib/observability/provider-attempt"

// AnySearch 的 REST 搜索返回结构化 JSON；MCP extract 返回清洗后的 Markdown。
// API Key 可选：未配置 ANYSEARCH_API_KEY 时，服务会自动使用较低配额的匿名访问。

export type SearchResult = {
  title: string
  url: string
  snippet: string
}

/** AnySearch 支持匿名访问，因此联网工具不依赖本地凭据也可启用。 */
export function isSearchConfigured() {
  return true
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Anysearch-Client": ANYSEARCH_CLIENT_HEADER,
  }
  const apiKey = process.env.ANYSEARCH_API_KEY?.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

type AnySearchResult = {
  title?: string
  url?: string
  snippet?: string
  content?: string
}

type AnySearchSearchResponse = {
  code?: number
  message?: string
  data?: {
    results?: AnySearchResult[]
  }
  // 兼容官网文档展示的未包 data 形式；线上实测响应目前使用 data.results。
  results?: AnySearchResult[]
}

class AnySearchProviderError extends Error {
  readonly code: string

  constructor(
    action: string,
    readonly status: number,
    code = "ANYSEARCH_PROVIDER_ERROR"
  ) {
    super(`AnySearch ${action}失败（HTTP ${status}）`)
    this.name = "AnySearchProviderError"
    this.code = code
  }
}

function providerError(action: string, status: number) {
  return new AnySearchProviderError(action, status)
}

async function anySearchJson<T>(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal
): Promise<{ response: Response; data: T }> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) forwardAbort()
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true })
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("AnySearch request timed out", "TimeoutError")
      ),
    ANYSEARCH_REQUEST_TIMEOUT_MS
  )
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { response, data: (await response.json()) as T }
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", forwardAbort)
  }
}

/** 联网搜索：返回轻量摘要；需要正文时由模型继续调用 readUrl。 */
export async function webSearch(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
  context: {
    routeReason?: string
    attemptIndex?: number
    fallbackCount?: number
  } = {}
): Promise<{ results: SearchResult[] }> {
  const resultLimit = Math.max(
    1,
    Math.min(maxResults, ANYSEARCH_SEARCH_RESULT_LIMIT)
  )
  return runProviderAttempt(
    {
      provider: ANYSEARCH_PROVIDER_NAME,
      operation: "search",
      query,
      ...context,
      usage: { unit: "request", quantity: 1, estimated: true },
    },
    async () => {
      const { response: res, data } =
        await anySearchJson<AnySearchSearchResponse>(
          ANYSEARCH_SEARCH_API_URL,
          {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              query,
              max_results: resultLimit,
              format: "json",
            }),
          },
          signal
        )
      if (!res.ok || (data.code !== undefined && data.code !== 0)) {
        throw providerError("搜索", res.status)
      }

      const results = (data.data?.results ?? data.results ?? [])
        .filter((result): result is AnySearchResult & { url: string } =>
          Boolean(result.url?.trim())
        )
        .map((result) => {
          const url = result.url.trim()
          const snippet = result.snippet?.trim() || result.content?.trim() || ""
          return {
            title: result.title?.trim() || url,
            url,
            snippet: snippet.slice(0, ANYSEARCH_SEARCH_RESULT_CHAR_LIMIT),
          }
        })

      return { results }
    },
    ({ results }) => ({
      outcome: results.length > 0 ? "success" : "empty",
      resultCount: results.length,
    })
  )
}

type AnySearchMcpResponse = {
  error?: { message?: string }
  result?: {
    content?: { type?: string; text?: string }[]
  }
}

/** 抽取单个 HTML 网页的正文；AnySearch 直接返回 Markdown。 */
export async function extractUrl(
  url: string,
  signal?: AbortSignal,
  context: {
    routeReason?: string
    attemptIndex?: number
    fallbackCount?: number
  } = {}
): Promise<string> {
  return runProviderAttempt(
    {
      provider: ANYSEARCH_PROVIDER_NAME,
      operation: "extract",
      url,
      ...context,
      usage: { unit: "request", quantity: 1, estimated: true },
    },
    async () => {
      const { response: res, data } = await anySearchJson<AnySearchMcpResponse>(
        ANYSEARCH_MCP_API_URL,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "extract", arguments: { url } },
          }),
        },
        signal
      )
      if (!res.ok || data.error) {
        throw providerError("网页抽取", res.status)
      }

      const text = data.result?.content?.find(
        (item) => item.type === "text" && typeof item.text === "string"
      )?.text
      if (!text)
        throw new AnySearchProviderError("网页抽取", res.status, "EMPTY_RESULT")
      return text
    },
    (text) => ({
      outcome: text.trim() ? "success" : "unusable",
      responseCharacters: text.length,
    })
  )
}
