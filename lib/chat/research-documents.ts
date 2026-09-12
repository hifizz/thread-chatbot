import { EXTRACT_CHAR_LIMIT, WEB_DOCUMENT_CHAR_LIMIT, WEB_SNAPSHOT_CHAR_LIMIT } from "@/constants/research"
import { WebAccessError, webContentBudgetExceeded, type WebBudget } from "@/lib/ai/web-access"

type Page = { url: string; content: string; title?: string; publishedDate?: string }
type Snapshot = { page: Page; id: string; fetchedAt: string; readThrough: number; cursors: Map<string, number> }

/** 优先段落/行边界。超长块允许拆分，且不拆开 UTF-16 代理对。 */
export function documentPageEnd(content: string, start: number, limit: number): number {
  if (limit <= 0) return start
  let end = Math.min(content.length, start + limit)
  if (end === content.length) return end
  const minimum = start + Math.floor(limit / 2)
  const paragraph = content.lastIndexOf("\n\n", end - 2)
  const line = content.lastIndexOf("\n", end - 1)
  if (paragraph >= minimum) end = paragraph + 2
  else if (line >= minimum) end = line + 1
  if (end > start && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) end--
  return end
}

/** 生命周期为一次生成。游标只在所属工具实例中有效，不跨用户或请求共享。 */
export function createResearchDocuments(budget: WebBudget) {
  const snapshots = new Map<string, Snapshot>()
  const pending = new Map<string, Promise<Snapshot>>()
  let storedChars = 0

  async function get(url: string, fetchPage: () => Promise<Page>): Promise<Snapshot> {
    const saved = snapshots.get(url)
    if (saved) return saved
    const existing = pending.get(url)
    if (existing) return existing
    const request = (async () => {
      const page = await fetchPage()
      if (page.content.length > WEB_DOCUMENT_CHAR_LIMIT || storedChars + page.content.length > WEB_SNAPSHOT_CHAR_LIMIT) {
        throw new WebAccessError("DOCUMENT_TOO_LARGE", "资料过大，无法保存完整读取快照；请缩小资料范围或提供相关章节。", "stop")
      }
      const snapshot = { page, id: crypto.randomUUID(), fetchedAt: new Date().toISOString(), readThrough: 0, cursors: new Map<string, number>() }
      storedChars += page.content.length
      snapshots.set(url, snapshot)
      budget.registerSnapshot()
      return snapshot
    })()
    pending.set(url, request)
    try { return await request } finally { pending.delete(url) }
  }

  return {
    async read(url: string, cursor: string | undefined, signal: AbortSignal | undefined, fetchPage: () => Promise<Page>) {
      signal?.throwIfAborted()
      if (budget.remainingChars <= 0) throw webContentBudgetExceeded()
      // 无效/外部游标不能触发新抓取，也不能用于另一 URL。
      const previous = snapshots.get(url)
      if (cursor !== undefined && (!previous || !previous.cursors.has(cursor))) {
        throw new WebAccessError("INVALID_READ_CURSOR", "续读位置无效或不属于本次生成；如需重新阅读，请不带游标读取原链接。", "stop")
      }
      const cacheHit = snapshots.has(url)
      const snapshot = previous ?? await get(url, fetchPage)
      signal?.throwIfAborted()
      const start = cursor === undefined ? 0 : snapshot.cursors.get(cursor)!
      const { page } = snapshot
      // 先预留固定元数据的实际序列化大小，再选择正文；最后按真实返回大小扣账。
      const nextToken = crypto.randomUUID()
      const base = { url, title: page.title ?? null, publishedDate: page.publishedDate ?? null,
        docId: snapshot.id, fetchedAt: snapshot.fetchedAt, cacheHit,
        totalChars: page.content.length, coverageBasis: "extracted-snapshot" as const }
      const makeResult = (end: number) => ({ ...base, content: page.content.slice(start, end),
        returnedChars: end - start, range: { start, end }, truncated: start > 0 || end < page.content.length,
        fullyRead: Math.max(snapshot.readThrough, end) >= page.content.length,
        hasMore: end < page.content.length, nextCursor: end < page.content.length ? nextToken : null })
      const overhead = JSON.stringify(makeResult(start)).length
      const limit = Math.min(EXTRACT_CHAR_LIMIT, budget.remainingChars - overhead)
      if (limit <= 0) throw webContentBudgetExceeded()
      let end = documentPageEnd(page.content, start, limit)
      let result = makeResult(end)
      // JSON 转义（例如代码中的引号）同样占用工具结果空间。
      if (JSON.stringify(result).length > budget.remainingChars) {
        let low = start, high = end
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (JSON.stringify(makeResult(middle)).length <= budget.remainingChars) low = middle
          else high = middle - 1
        }
        end = documentPageEnd(page.content, start, low - start)
        result = makeResult(end)
      }
      if (end <= start) throw webContentBudgetExceeded()
      budget.spendContent(JSON.stringify(result).length)
      snapshot.readThrough = Math.max(snapshot.readThrough, end)
      if (result.hasMore) snapshot.cursors.set(nextToken, end)
      return result
    },
  }
}
