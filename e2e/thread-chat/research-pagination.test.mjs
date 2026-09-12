import { settledResearchActivities } from "../../lib/chat/web-research-activity.ts"
import { assistantPartRenderPlan } from "../../app/thread-chat/branching/assistant/assistant-part-render-plan.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { createResearchDocuments, documentPageEnd } from "../../lib/chat/research-documents.ts"
import { createWebBudget, availableResearchTools } from "../../lib/ai/web-access.ts"
import { createResearchTools } from "../../lib/chat/research-tools.ts"
import { EXTRACT_CHAR_LIMIT, WEB_DOCUMENT_CHAR_LIMIT } from "../../constants/research.ts"

await test("12 万字符按同一快照续读，无遗漏/重复；网络耗尽仍可读缓存", async () => {
  const budget = createWebBudget({ maxProviderAttempts: 1 })
  const store = createResearchDocuments(budget)
  const content = Array.from({ length: 1700 }, (_, i) => `段落 ${i} ${"甲乙丙丁".repeat(18)}\n\n`).join("")
  let fetches = 0, cursor, combined = "", last
  const fetchPage = () => budget.run(undefined, async () => { fetches++; return { url: "https://example.com", content } })
  do {
    last = await store.read("https://example.com", cursor, undefined, fetchPage)
    assert.equal(last.range.start, combined.length)
    assert.ok(last.returnedChars <= EXTRACT_CHAR_LIMIT)
    assert.equal(last.content.length, last.returnedChars)
    combined += last.content
    cursor = last.nextCursor ?? undefined
    assert.ok(availableResearchTools(["readUrl", "webSearch"], budget).includes("readUrl"))
  } while (last.hasMore)
  assert.equal(combined, content)
  assert.equal(last.fullyRead, true)
  assert.equal(fetches, 1)
  assert.equal(last.cacheHit, true)
})

await test("游标绑定 URL 与工具实例；错误游标不触发抓取", async () => {
  const store = createResearchDocuments(createWebBudget())
  const fetchPage = async () => ({ url: "https://example.com", content: "a".repeat(20_000) })
  const first = await store.read("https://example.com", undefined, undefined, fetchPage)
  for (const [reader, url] of [[store, "https://example.org"], [createResearchDocuments(createWebBudget()), "https://example.com"]]) {
    await assert.rejects(reader.read(url, first.nextCursor, undefined, () => { throw new Error("must not fetch") }), { code: "INVALID_READ_CURSOR" })
  }
})

await test("正文和元数据共同计量；并行读取不超额，耗尽不能用空大纲循环", async () => {
  const budget = createWebBudget({ maxContentChars: 2300 })
  const store = createResearchDocuments(budget)
  const results = await Promise.allSettled(["a", "b", "c"].map((id) => store.read(`https://example.com/${id}`, undefined, undefined, async () => ({ url: id, content: '\\"\n'.repeat(10_000) }))))
  const sent = results.filter((x) => x.status === "fulfilled").map((x) => x.value)
  assert.ok(sent.length > 0)
  assert.ok(sent.reduce((sum, value) => sum + JSON.stringify(value).length, 0) <= 2300)
  assert.ok(results.some((x) => x.status === "rejected" && x.reason.code === "WEB_CONTENT_BUDGET_EXHAUSTED"))
})

await test("优先段落边界，超长块回退硬切且不破坏 emoji", () => {
  assert.equal(documentPageEnd("\n\nabc", 0, 0), 0)
  assert.equal(documentPageEnd("abc\n\ndefgh", 0, 7), 5)
  const content = "a".repeat(15_999) + "😀" + "b".repeat(20_000)
  assert.equal(documentPageEnd(content, 0, 16_000), 15_999)
})

await test("并行同页只抓一次，内容修改不影响快照；取消后不交付正文", async () => {
  const store = createResearchDocuments(createWebBudget())
  let fetches = 0
  const fetchPage = async () => { fetches++; await new Promise((r) => setTimeout(r, 5)); return { url: "https://example.com", content: "A".repeat(20_000) } }
  const [first, second] = await Promise.all([store.read("https://example.com", undefined, undefined, fetchPage), store.read("https://example.com", undefined, undefined, fetchPage)])
  assert.equal(fetches, 1)
  assert.equal(first.docId, second.docId)
  const next = await store.read("https://example.com", first.nextCursor, undefined, async () => ({ url: "https://example.com", content: "B" }))
  assert.equal(next.content, "A".repeat(4000))
  await assert.rejects(store.read("https://example.com", undefined, AbortSignal.abort(), fetchPage), { name: "AbortError" })
})

await test("超大快照明确拒绝，不静默裁剪冒充全文", async () => {
  const store = createResearchDocuments(createWebBudget())
  await assert.rejects(store.read("https://example.com", undefined, undefined, async () => ({ url: "https://example.com", content: "a".repeat(WEB_DOCUMENT_CHAR_LIMIT + 1) })), { code: "DOCUMENT_TOO_LARGE" })
})

await test("搜索按完整条目裁剪；结果也计入共享内容额度", async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ results: Array.from({ length: 8 }, (_, i) => ({ title: `来源${i}`, url: `https://example.com/${i}`, snippet: "证据".repeat(900) })) })
    const budget = createWebBudget()
    const result = await createResearchTools({ budget }).webSearch.execute({ query: "测试" }, { toolCallId: "1", messages: [] })
    assert.equal(result.ok, true)
    assert.equal(result.data.results.length, 3)
    assert.ok(result.data.results.every((item) => item.snippet.length === 1800))
    assert.ok(JSON.stringify(result.data).length <= 6000)
    assert.equal(budget.remainingChars, 160_000 - JSON.stringify(result.data).length)
  } finally { globalThis.fetch = original }
})

await test("GPT Luna 首次读取的空字符串/null 游标视为省略", async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ result: { structuredContent: { content: "73 个项目" } } })
    for (const cursor of [undefined, "", null, "  "]) {
      const result = await createResearchTools().readUrl.execute({ url: "https://example.com", cursor }, { toolCallId: "empty", messages: [] })
      assert.equal(result.ok, true)
      assert.equal(result.data.content, "73 个项目")
    }
  } finally { globalThis.fetch = original }
})

await test("同一工具调用并发合并上游，但每份送入模型的返回分别计量", async () => {
  const original = globalThis.fetch
  try {
    let calls = 0
    globalThis.fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return Response.json({ result: { structuredContent: { content: "同页正文" } } }) }
    const budget = createWebBudget()
    const tools = createResearchTools({ budget })
    const results = await Promise.all([1, 2].map((n) => tools.readUrl.execute({ url: "https://example.com" }, { toolCallId: String(n), messages: [] })))
    assert.equal(calls, 1)
    assert.ok(results.every((r) => r.ok))
    assert.equal(160_000 - budget.remainingChars, results.reduce((sum, r) => sum + JSON.stringify(r.data).length, 0))
  } finally { globalThis.fetch = original }
})

await test("超过并发上限的独立请求排队，峰值为3且全部完成", async () => {
  const budget = createWebBudget({ maxProviderAttempts: 9, maxConcurrency: 3 })
  let active = 0, peak = 0
  await Promise.all(Array.from({ length: 9 }, () => budget.run(undefined, async () => {
    active++; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
  })))
  assert.equal(peak, 3)
  assert.equal(budget.attempts, 9)
})

await test("停止后不残留读取进度或内部工具状态，已完成来源仍保留", () => {
  const activities = [
    { toolCallId: "1", kind: "read", status: "complete", url: "https://example.com/a", sources: [] },
    { toolCallId: "2", kind: "read", status: "running", url: "https://example.com/b", sources: [] },
  ]
  assert.equal(settledResearchActivities(activities, false), activities)
  assert.deepEqual(settledResearchActivities(activities, true).map((a) => a.status), ["complete", "failed"])
  assert.equal(activities[1].status, "running")
  const plan = assistantPartRenderPlan({ text: "", status: "stopped", uiParts: [
    { type: "tool-readUrl", toolCallId: "2", state: "input-available", input: { url: "https://example.com/b" } },
    { type: "data-research-activity", data: activities[1] },
  ] })
  assert.deepEqual(plan.map((p) => p.kind), ["research"])
})
