import {
  ANYSEARCH_CLIENT_HEADER,
  ANYSEARCH_MCP_API_URL,
  ANYSEARCH_PROVIDER_NAME,
  ANYSEARCH_SEARCH_API_URL,
  ANYSEARCH_SEARCH_RESULT_CHAR_LIMIT,
  ANYSEARCH_SEARCH_RESULT_LIMIT,
} from "@/constants/research"

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

type SearchProviderOperation = "search" | "extract"

function logSearchProvider(operation: SearchProviderOperation) {
  if (process.env.NODE_ENV !== "development") return

  console.info(
    `[web-research] provider=${ANYSEARCH_PROVIDER_NAME} operation=${operation}`
  )
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

function providerError(action: string, status: number, message?: string) {
  const detail = message?.trim() ? `：${message.trim()}` : ""
  return new Error(`AnySearch ${action}失败（HTTP ${status}）${detail}`)
}

/** 联网搜索：返回轻量摘要；需要正文时由模型继续调用 readUrl。 */
export async function webSearch(
  query: string,
  maxResults = 5
): Promise<{ results: SearchResult[] }> {
  const resultLimit = Math.max(
    1,
    Math.min(maxResults, ANYSEARCH_SEARCH_RESULT_LIMIT)
  )
  logSearchProvider("search")
  const res = await fetch(ANYSEARCH_SEARCH_API_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      query,
      max_results: resultLimit,
      format: "json",
    }),
  })
  const data = (await res.json()) as AnySearchSearchResponse
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    throw providerError("搜索", res.status, data.message)
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
}

type AnySearchMcpResponse = {
  error?: { message?: string }
  result?: {
    content?: { type?: string; text?: string }[]
  }
}

/** 抽取单个 HTML 网页的正文；AnySearch 直接返回 Markdown。 */
export async function extractUrl(url: string): Promise<string> {
  logSearchProvider("extract")
  const res = await fetch(ANYSEARCH_MCP_API_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "extract", arguments: { url } },
    }),
  })
  const data = (await res.json()) as AnySearchMcpResponse
  if (!res.ok || data.error) {
    throw providerError("网页抽取", res.status, data.error?.message)
  }

  const text = data.result?.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  )?.text
  if (!text) throw new Error("AnySearch 网页抽取失败：服务未返回正文")
  return text
}
