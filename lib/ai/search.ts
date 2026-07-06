// 可配置的 Web 搜索 / 网页抽取 provider，默认 Tavily（面向 AI/RAG 场景，/search 直接返回正文快照，
// 另有 /extract 抽取整页正文）。未配置 SEARCH_API_KEY 时深度研究降级为不可用。
// 换用其它兼容服务可改 SEARCH_BASE_URL，但响应解析以 Tavily 结构为准。

export type SearchResult = {
  title: string
  url: string
  /** 正文快照（Tavily /search 直接返回，通常足够回答） */
  content: string
}

export function isSearchConfigured() {
  return Boolean(process.env.SEARCH_API_KEY)
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
