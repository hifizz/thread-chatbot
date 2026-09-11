import {
  EXA_CONTENTS_API_URL,
  EXA_PROVIDER_NAME,
  ANYSEARCH_CLIENT_HEADER,
  ANYSEARCH_MCP_API_URL,
  ANYSEARCH_PROVIDER_NAME,
  ANYSEARCH_REQUEST_TIMEOUT_MS,
  ANYSEARCH_SEARCH_API_URL,
  ANYSEARCH_SEARCH_RESULT_CHAR_LIMIT,
  ANYSEARCH_SEARCH_RESULT_LIMIT,
} from "@/constants/research"
import { WebAccessError, assertUsablePage, normalizeWebUrl, type WebBudget } from "@/lib/ai/web-access"
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

function providerError(action: string, status: number, code = "WEB_PROVIDER_ERROR") {
  return new WebAccessError(code, `${action}未取得可用结果。`, "search", true, status)
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
    if (!response.ok) throw providerError("联网请求", response.status)
    try {
      return { response, data: (await response.json()) as T }
    } catch (error) {
      if (error instanceof SyntaxError) throw providerError("响应解析", response.status, "INVALID_RESPONSE")
      throw error
    }
  } catch (error) {
    externalSignal?.throwIfAborted()
    if (controller.signal.aborted) throw providerError("请求超时", 408, "WEB_TIMEOUT")
    if (error instanceof TypeError && /fetch failed|network|failed to fetch/i.test(error.message)) {
      throw providerError("网络连接", 502)
    }
    throw error
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
    structuredContent?: { url?: string; title?: string; content?: string; error?: unknown }
    isError?: boolean
    content?: { type?: string; text?: string }[]
  }
}

/** MCP 可能用结构化 content，或在文本块里编码 JSON。只解包已知正文形状。 */
function unwrapExtractText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return trimmed
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object") {
      if ("error" in parsed && parsed.error) throw providerError("网页抽取", 200, "WEB_PROVIDER_TOOL_ERROR")
      if ("content" in parsed && typeof parsed.content === "string") return parsed.content.trim()
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  return trimmed
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
      if (!res.ok) throw providerError("网页抽取", res.status)
      if (data.error) throw providerError("网页抽取", res.status, "WEB_PROVIDER_RPC_ERROR")
      if (data.result?.isError) {
        const message = data.result.content?.map((item) => item.text ?? "").join(" ") ?? ""
        if (/blocked (?:url|address)|private (?:ip|address)|ssrf|unsafe url|invalid url/i.test(message)) {
          throw new WebAccessError("UNSAFE_URL", "该网址无法安全读取。", "stop", false, res.status)
        }
        throw providerError("网页抽取", res.status, "WEB_PROVIDER_TOOL_ERROR")
      }

      if (data.result?.structuredContent?.error) throw providerError("网页抽取", res.status)
      const text = data.result?.structuredContent?.content ?? (data.result?.content ?? [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => unwrapExtractText(item.text ?? "")).join("\n").trim()
      const content = unwrapExtractText(text)
      assertUsablePage(content)
      return content
    },
    (text) => ({
      outcome: text.trim() ? "success" : "unusable",
      responseCharacters: text.length,
    })
  )
}

/** 同一 URL 的有限备用不暴露为新的模型工具。 */
export async function webFetch(url: string, context: {
  signal?: AbortSignal
  budget: WebBudget
  routeReason?: string
}): Promise<{ url: string; content: string; title?: string; publishedDate?: string }> {
  const normalized = normalizeWebUrl(url)
  const providers = [ANYSEARCH_PROVIDER_NAME, ...(process.env.EXA_API_KEY?.trim() ? [EXA_PROVIDER_NAME] : [])]
  for (const [fallbackCount, provider] of providers.entries()) {
    context.signal?.throwIfAborted()
    try {
      return await context.budget.run(context.signal, async (signal, attemptIndex) => {
        const attempt = { routeReason: context.routeReason, attemptIndex, fallbackCount }
        if (provider === ANYSEARCH_PROVIDER_NAME) {
          return { url: normalized, content: await extractUrl(normalized, signal, attempt) }
        }
        return runProviderAttempt({ provider, operation: "extract", url: normalized, ...attempt,
          usage: { unit: "request", quantity: 1, estimated: true } }, async () => {
          const { data, response } = await anySearchJson<{
            results?: { url?: string; text?: string; title?: string; publishedDate?: string }[]
            statuses?: { status?: string }[]
          }>(EXA_CONTENTS_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY!.trim() },
            body: JSON.stringify({ urls: [normalized], text: true }),
          }, signal)
          if (data.statuses?.some((item) => item.status !== "success")) throw providerError("网页抽取", response.status)
          const page = data.results?.[0]
          const content = page?.text?.trim() ?? ""
          assertUsablePage(content)
          return { url: normalized, content, title: page?.title, publishedDate: page?.publishedDate }
        }, (page) => ({ outcome: "success", responseCharacters: page.content.length }))
      })
    } catch (error) {
      context.signal?.throwIfAborted()
      if (!(error instanceof WebAccessError) || !error.allowProviderFallback) throw error
      if (fallbackCount === providers.length - 1) throw error
    }
  }
  throw providerError("网页抽取", 502)
}
