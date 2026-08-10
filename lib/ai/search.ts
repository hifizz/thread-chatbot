import { z } from "zod"
import {
  AUTO_WEB_SEARCH_MAX_RESULTS,
  AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT,
  AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT,
  AUTO_WEB_SEARCH_TITLE_CHAR_LIMIT,
  AUTO_WEB_SEARCH_TIMEOUT_MS,
  PROGRAMMING_OFFICIAL_DOMAIN_HINTS,
  AUTO_WEB_SEARCH_URL_CHAR_LIMIT,
} from "../../constants/web-search.ts"

// 可配置的 Web 搜索 / 网页抽取 provider，默认 Tavily（面向 AI/RAG 场景，/search 直接返回正文快照，
// 另有 /extract 抽取整页正文）。未配置 SEARCH_API_KEY 时深度研究降级为不可用。
// 换用其它兼容服务可改 SEARCH_BASE_URL，但响应解析以 Tavily 结构为准。

export type SearchResult = {
  title: string
  url: string
  /** 正文快照（Tavily /search 直接返回，通常足够回答） */
  content: string
}

export type AutoSearchResult = {
  sourceId: string
  title: string
  url: string
  snippet: string
}

export type AutoSearchErrorCode =
  | "missing_configuration"
  | "timeout"
  | "rate_limited"
  | "provider_error"
  | "invalid_response"
  | "empty_results"
  | "all_results_filtered"

export class AutoWebSearchError extends Error {
  readonly code: AutoSearchErrorCode
  readonly status: number | null
  readonly providerCredits: number | null

  constructor(
    code: AutoSearchErrorCode,
    message: string,
    options: { status?: number; providerCredits?: number | null } = {}
  ) {
    super(message)
    this.name = "AutoWebSearchError"
    this.code = code
    this.status = options.status ?? null
    this.providerCredits = options.providerCredits ?? null
  }
}

export function isSearchConfigured() {
  return Boolean(process.env.SEARCH_API_KEY?.trim())
}

function baseUrl() {
  return process.env.SEARCH_BASE_URL ?? "https://api.tavily.com"
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.SEARCH_API_KEY}`,
  }
}

type TavilySearchResponse = {
  answer?: string
  results?: { title?: string; url?: string; content?: string }[]
}

const tavilyAutoSearchResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
            content: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    usage: z
      .object({
        credits: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  ) {
    return false
  }

  const [a, b] = parts.map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!normalized.includes(":")) return false
  if (
    normalized.startsWith("::") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89a-f]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true
  }
  return false
}

const TRACKING_QUERY_KEYS = new Set(["fbclid", "gclid", "dclid", "msclkid"])

/** 仅接收公开 HTTP(S) 来源，并生成用于去重的 canonical URL。 */
export function normalizePublicSearchUrl(value: string): string | null {
  try {
    if (value.length > AUTO_WEB_SEARCH_URL_CHAR_LIMIT) return null
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      isBlockedIpv4(hostname) ||
      isBlockedIpv6(hostname)
    ) {
      return null
    }

    url.hostname = hostname
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    return url.toString()
  } catch {
    return null
  }
}

function truncateSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT) return normalized
  return normalized.slice(0, AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT).trimEnd()
}

function sourceIdFor(url: string): string {
  let hash = 2166136261
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `src_${(hash >>> 0).toString(36)}`
}

export function normalizeAutoSearchResults(
  results: Array<{ title?: string; url?: string; content?: string }>
): AutoSearchResult[] {
  const accepted: AutoSearchResult[] = []
  const seen = new Set<string>()

  for (const result of results) {
    if (accepted.length >= AUTO_WEB_SEARCH_MAX_RESULTS) break
    if (!result.url) continue
    const url = normalizePublicSearchUrl(result.url)
    if (!url || seen.has(url)) continue
    seen.add(url)

    accepted.push({
      sourceId: sourceIdFor(url),
      title:
        (result.title?.trim() || url).slice(0, AUTO_WEB_SEARCH_TITLE_CHAR_LIMIT) ||
        url,
      url,
      snippet: truncateSnippet(result.content ?? ""),
    })
  }
  return accepted
}

export function preferredOfficialDomains(query: string): string[] {
  return [
    ...new Set(
      PROGRAMMING_OFFICIAL_DOMAIN_HINTS.flatMap(({ pattern, domains }) =>
        pattern.test(query) ? domains : []
      )
    ),
  ].slice(0, 3)
}

function autoSearchErrorForStatus(status: number): AutoWebSearchError {
  if (status === 408 || status === 504) {
    return new AutoWebSearchError("timeout", "搜索请求超时", { status })
  }
  if (status === 429) {
    return new AutoWebSearchError("rate_limited", "搜索服务限流", { status })
  }
  return new AutoWebSearchError("provider_error", "搜索服务请求失败", {
    status,
  })
}

function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs)
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener("abort", abortFromParent, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      parentSignal?.removeEventListener("abort", abortFromParent)
    },
  }
}

type AutoWebSearchOptions = {
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Thread Chat 的轻量 Tavily Basic Search。Provider wire format 在此终止，
 * 调用方只会得到最小、规范化且去重后的证据。
 */
export async function autoWebSearch(
  query: string,
  options: AutoWebSearchOptions = {}
): Promise<{ results: AutoSearchResult[]; providerCredits: number | null }> {
  const normalizedQuery = query.trim()
  if (
    normalizedQuery.length === 0 ||
    normalizedQuery.length > AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT
  ) {
    throw new AutoWebSearchError("invalid_response", "搜索 query 无效")
  }
  if (!isSearchConfigured()) {
    throw new AutoWebSearchError("missing_configuration", "搜索服务未配置")
  }

  const { signal, dispose } = createTimeoutSignal(
    options.timeoutMs ?? AUTO_WEB_SEARCH_TIMEOUT_MS,
    options.signal
  )
  try {
    const officialDomains = preferredOfficialDomains(normalizedQuery)
    const response = await (options.fetch ?? fetch)(`${baseUrl()}/search`, {
      method: "POST",
      headers: authHeaders(),
      signal,
      body: JSON.stringify({
        query: normalizedQuery,
        max_results: AUTO_WEB_SEARCH_MAX_RESULTS,
        search_depth: "basic",
        include_answer: false,
        include_usage: true,
        ...(officialDomains.length
          ? { include_domains: officialDomains }
          : {}),
      }),
    })
    if (!response.ok) throw autoSearchErrorForStatus(response.status)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AutoWebSearchError("invalid_response", "搜索响应不是有效 JSON")
    }
    const parsed = tavilyAutoSearchResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new AutoWebSearchError("invalid_response", "搜索响应结构无效")
    }

    const rawResults = parsed.data.results ?? []
    if (rawResults.length === 0) {
      throw new AutoWebSearchError("empty_results", "搜索没有返回结果", {
        providerCredits: parsed.data.usage?.credits,
      })
    }
    const results = normalizeAutoSearchResults(rawResults)
    if (results.length === 0) {
      throw new AutoWebSearchError(
        "all_results_filtered",
        "搜索结果未通过安全校验",
        { providerCredits: parsed.data.usage?.credits }
      )
    }
    return {
      results,
      providerCredits: parsed.data.usage?.credits ?? null,
    }
  } catch (error) {
    if (error instanceof AutoWebSearchError) throw error
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new AutoWebSearchError("timeout", "搜索请求超时")
    }
    throw new AutoWebSearchError("provider_error", "搜索服务请求失败")
  } finally {
    dispose()
  }
}

/** 联网搜索：返回带正文快照的结果列表 */
export async function webSearch(
  query: string,
  maxResults = 5
): Promise<{ answer?: string; results: SearchResult[] }> {
  const res = await fetch(`${baseUrl()}/search`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "advanced",
      include_answer: true,
    }),
  })
  if (!res.ok) throw new Error(`搜索失败（HTTP ${res.status}）`)
  const data = (await res.json()) as TavilySearchResponse
  const results = (data.results ?? [])
    .filter((r): r is Required<typeof r> => Boolean(r.url))
    .map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      content: r.content ?? "",
    }))
  return { answer: data.answer, results }
}

type TavilyExtractResponse = {
  results?: { url?: string; raw_content?: string }[]
}

/** 抽取单个网页的正文（搜索快照不够时按需深读） */
export async function extractUrl(url: string): Promise<string> {
  const res = await fetch(`${baseUrl()}/extract`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ urls: [url] }),
  })
  if (!res.ok) throw new Error(`网页抽取失败（HTTP ${res.status}）`)
  const data = (await res.json()) as TavilyExtractResponse
  return data.results?.[0]?.raw_content ?? ""
}
