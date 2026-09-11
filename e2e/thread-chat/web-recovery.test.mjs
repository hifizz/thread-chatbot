import assert from "node:assert/strict"
import { test } from "node:test"
import { extractUrl, webFetch } from "../../lib/ai/search.ts"
import { createResearchTools } from "../../lib/chat/research-tools.ts"
import { createWebBudget, WebAccessError } from "../../lib/ai/web-access.ts"
import { createWebResearchActivityDispatcher, webResearchSourcesFromOutput } from "../../lib/chat/web-research-activity.ts"
import { resolveGenerationMode } from "../../lib/thread-chat/streaming/generation-modes.ts"
import { createToolStepPolicy } from "../../app/api/chat/tool-step-policy.ts"
import { EXTRACT_CHAR_LIMIT } from "../../constants/research.ts"
const originalFetch = globalThis.fetch
const key = process.env.EXA_API_KEY
const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
const page = (text) => json({ result: { content: [{ type: "text", text }] } })
const opts = { toolCallId: "test", messages: [] }
try {
await test("两个入口首步读取，之后开放搜索；answer 与 artifact 能力范围不变", () => {
  for (const artifactRequested of [false, true]) {
    const mode = resolveGenerationMode({ researchMode: "fetch", artifactRequested })
    const policy = createToolStepPolicy({ researchMode: "fetch", isThreadChat: true, markdownArtifactRequested: artifactRequested })
    assert.deepEqual(mode.toolNames, policy({ stepNumber: 1 }).activeTools)
    assert.equal(mode.firstTool, "readUrl")
    assert.equal(policy({ stepNumber: 1 }).toolChoice, "auto")
  }
  assert.deepEqual(resolveGenerationMode({ researchMode: "answer", artifactRequested: false }).toolNames, [])
  assert.deepEqual(resolveGenerationMode({ researchMode: "answer", artifactRequested: true }).toolNames, ["createMarkdownArtifact"])
})
await test("HTTP 200 工具级错误、空白、错误页失败，多文本块合并", async () => {
  for (const body of [{ result: { isError: true, content: [{ type: "text", text: "secret error" }] } }, { result: { content: [{ type: "text", text: " \n " }] } }, { result: { content: [{ type: "text", text: "Access Denied" }] } }]) {
    globalThis.fetch = async () => json(body)
    await assert.rejects(extractUrl("https://example.com"), WebAccessError)
  }
  globalThis.fetch = async () => json({ result: { content: [{ type: "text", text: "first" }, { type: "image", text: "ignored" }, { type: "text", text: "second" }] } })
  assert.equal(await extractUrl("https://example.com"), "first\nsecond")
})
await test("真实 OpenAI 错误页样本：结构化正文及 JSON 文本都必须校验", async () => {
  for (const result of [
    { structuredContent: { content: "# This page couldnâ€™t load\\n\\nReload to try again, or go back." }, content: [{ type: "text", text: "encoded JSON" }] },
    { content: [{ type: "text", text: JSON.stringify({ content: "# This page couldn't load" }) }] },
  ]) {
    globalThis.fetch = async () => json({ result })
    await assert.rejects(extractUrl("https://openai.com/index/introducing-the-agents-api/"), (e) => e.code === "UNUSABLE_CONTENT")
  }
  globalThis.fetch = async () => json({ result: { structuredContent: { content: "Actual article" }, content: [{ type: "text", text: "encoded JSON" }] } })
  assert.equal(await extractUrl("https://example.com"), "Actual article")
})
await test("主成功不备用、主失败备用成功、全部失败、没有凭据不备用", async () => {
  process.env.EXA_API_KEY = "fixture"
  let urls = []
  globalThis.fetch = async (url) => { urls.push(url); return page("valid article") }
  assert.equal((await webFetch("https://example.com", { budget: createWebBudget() })).content, "valid article")
  assert.equal(urls.length, 1)
  urls = []
  globalThis.fetch = async (url) => { urls.push(url); return String(url).includes("exa.ai") ? json({ results: [{ text: "fallback article" }] }) : json({ result: { isError: true } }) }
  const budget = createWebBudget()
  assert.equal((await webFetch("https://example.com", { budget })).content, "fallback article")
  assert.equal(budget.attempts, 2)
  assert.equal(urls.length, 2)
  globalThis.fetch = async () => json({ result: { isError: true } })
  await assert.rejects(webFetch("https://example.com", { budget: createWebBudget() }), WebAccessError)
  delete process.env.EXA_API_KEY
  let count = 0
  globalThis.fetch = async () => { count++; return json({ result: { isError: true } }) }
  await assert.rejects(webFetch("https://example.com", { budget: createWebBudget() }), WebAccessError)
  assert.equal(count, 1)
})
await test("安全拒绝、无效 URL、取消和未知异常不触发备用", async () => {
  process.env.EXA_API_KEY = "fixture"
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error("program bug") }
  for (const url of ["not url", "http://127.0.0.1", "file:///etc/passwd", "http://user:pass@example.com"]) {
    await assert.rejects(webFetch(url, { budget: createWebBudget() }), WebAccessError)
  }
  assert.equal(calls, 0)
  await assert.rejects(webFetch("https://example.com", { budget: createWebBudget(), signal: AbortSignal.abort() }))
  assert.equal(calls, 0)
  await assert.rejects(webFetch("https://example.com", { budget: createWebBudget() }), /program bug/)
  assert.equal(calls, 1)
})
await test("共享预算、并发去重、失败不重试、新查询可执行、截断契约", async () => {
  delete process.env.EXA_API_KEY
  let calls = 0
  globalThis.fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return json({ results: [] }) }
  const budget = createWebBudget({ maxProviderAttempts: 2 })
  const tools = createResearchTools({ budget })
  const first = await Promise.all([tools.webSearch.execute({ query: "q" }, opts), tools.webSearch.execute({ query: "q" }, opts)])
  assert.equal(calls, 1)
  assert.deepEqual(first[0], first[1])
  await tools.webSearch.execute({ query: " q " }, opts)
  assert.equal(calls, 1)
  await tools.webSearch.execute({ query: "different" }, opts)
  assert.equal(calls, 2)
  assert.equal((await tools.readUrl.execute({ url: "https://example.com" }, opts)).nextAction, "stop")
  globalThis.fetch = async () => page("a".repeat(EXTRACT_CHAR_LIMIT + 10))
  const result = await createResearchTools().readUrl.execute({ url: "https://example.com?a=1&b=2" }, opts)
  assert.equal(result.ok, true)
  assert.equal(result.data.truncated, true)
  assert.equal(result.data.content.length, EXTRACT_CHAR_LIMIT)
  assert.equal(result.data.url, "https://example.com/?a=1&b=2")
})
await test("并发硬计数与总时限终止在途请求，取消继续抛出", async () => {
  const budget = createWebBudget({ maxProviderAttempts: 2, maxDurationMs: 25 })
  let started = 0
  const work = (signal) => { started++; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) }
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => budget.run(undefined, work)))
  assert.equal(started, 2)
  assert.ok(results.every((result) => result.status === "rejected" && result.reason.code === "WEB_BUDGET_EXHAUSTED"))
  const controller = new AbortController()
  globalThis.fetch = async (_url, { signal }) => work(signal)
  const result = createResearchTools().readUrl.execute({ url: "https://example.com" }, { ...opts, abortSignal: controller.signal })
  controller.abort()
  await assert.rejects(result, (e) => e.name === "AbortError")
})
await test("并发上限、排队取消及跨轮失败隔离", async () => {
  const budget = createWebBudget({ maxConcurrency: 1 })
  const firstController = new AbortController()
  const queuedController = new AbortController()
  let calls = 0
  const hold = budget.run(firstController.signal, (signal) => new Promise((_resolve, reject) => {
    calls++
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }))
  const queued = budget.run(queuedController.signal, async () => { calls++ })
  queuedController.abort()
  await assert.rejects(queued)
  assert.equal(calls, 1)
  firstController.abort()
  await assert.rejects(hold)
  await budget.run(undefined, async () => { calls++ })
  assert.equal(calls, 2)
  delete process.env.EXA_API_KEY
  globalThis.fetch = async () => json({ results: [] })
  const firstTools = createResearchTools()
  assert.equal((await firstTools.webSearch.execute({ query: "same" }, opts)).ok, false)
  globalThis.fetch = async () => json({ results: [{ url: "https://example.com", title: "new result" }] })
  assert.equal((await createResearchTools().webSearch.execute({ query: "same" }, opts)).ok, true)
})
await test("预算耗尽后移除联网工具，保留最终说明与 Artifact", async () => {
  const budget = createWebBudget({ maxProviderAttempts: 1 })
  await budget.run(undefined, async () => {})
  const policy = createToolStepPolicy({ researchMode: "fetch", isThreadChat: true, markdownArtifactRequested: true, webBudget: budget })
  assert.deepEqual(policy({ stepNumber: 2 }), { activeTools: ["createMarkdownArtifact"], toolChoice: "auto" })
})
await test("供应商明确安全拒绝不得换供应商", async () => {
  process.env.EXA_API_KEY = "fixture"
  let count = 0
  globalThis.fetch = async () => { count++; return json({ result: { isError: true, content: [{ type: "text", text: "Blocked URL: private address" }] } }) }
  await assert.rejects(webFetch("https://example.com", { budget: createWebBudget() }), (e) => e.code === "UNSAFE_URL")
  assert.equal(count, 1)
})
await test("UI 不把失败当已读取，失败无来源，部分正文标记传递", () => {
  const activities = []
  const dispatch = createWebResearchActivityDispatcher((value) => activities.push(value))
  dispatch({ type: "tool-input-start", toolCallId: "1", toolName: "readUrl" })
  assert.equal(activities.length, 0)
  dispatch({ type: "tool-input-available", toolCallId: "1", toolName: "readUrl", input: { url: "https://example.com" } })
  dispatch({ type: "tool-output-available", toolCallId: "1", output: { ok: false, error: { message: "failure" } } })
  assert.equal(activities.at(-1).status, "failed")
  dispatch({ type: "tool-output-available", toolCallId: "1", output: { ok: true, data: { url: "https://example.com", content: "partial", truncated: true } } })
  assert.equal(activities.at(-1).truncated, true)
  assert.deepEqual(webResearchSourcesFromOutput({ ok: false, results: [{ url: "https://example.com" }] }), [])
  assert.equal(webResearchSourcesFromOutput({ ok: true, data: { results: [{ url: "https://example.com", title: "source" }] } }).length, 1)
})
} finally {
 globalThis.fetch = originalFetch
 if (key === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = key
}
