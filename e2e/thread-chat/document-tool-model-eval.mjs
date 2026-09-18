// 显式运行才调用真实模型；全部资料为合成数据，工具不会访问网页或读写项目数据库。
// node --env-file=.env.local --import tsx e2e/thread-chat/document-tool-model-eval.mjs <public-model-id> ...
import { generateText, stepCountIs } from "ai"
import { buildDocumentTools } from "../../lib/thread-chat/streaming/documents/tools.ts"
import { createResearchTools } from "../../lib/chat/research-tools.ts"
import { resolveChatModel } from "../../lib/ai/llm/providers.ts"
import { isTokenRouterConfigured } from "../../lib/ai/llm/token-router.ts"
import { DOCUMENT_INSTRUCTIONS, DOCUMENT_UNAVAILABLE_FAILURE } from "../../constants/project-documents.ts"

const models = process.argv.slice(2)
if (!models.length) throw new Error("请显式指定要评测的模型 public ID")
if (!isTokenRouterConfigured()) throw new Error("真实模型评测未运行：需要配置 TOKEN_ROUTER_BASE_URL 和 TOKEN_ROUTER_API_KEY")
const docs = Array.from({ length: 7 }, (_, index) => ({
  id: crypto.randomUUID(), projectId: crypto.randomUUID(), currentRevisionId: crypto.randomUUID(),
  title: `方案${index + 1}.md`, content: `方案${index + 1}：每次同步间隔为 ${index + 10} 分钟。`,
}))
const catalog = docs.map(({ id, projectId, currentRevisionId, title }) => ({ id, projectId, currentRevisionId, title }))
const url = "https://example.com/confidence"
const cachedId = crypto.randomUUID()
const cases = [
  { name: "公开网页", prompt: `读取 ${url} 的在线 API 文档，告诉我置信度的定义。`, web: true, count: 0 },
  { name: "跨轮旧网页ID", prompt: `上一轮 readUrl 返回 {"url":"${url}","docId":"${cachedId}","content":"摘要"}。现在请重新打开这份文档，核对置信度定义。`, web: true, count: 0 },
  { name: "七份项目文档", prompt: "请读取本项目已保存的方案1.md 到方案7.md 共七份文档，列出各自的同步间隔。", web: false, count: 7 },
  { name: "混合来源", prompt: `读取本项目保存的方案1.md，并读取 ${url} 的置信度定义，分别概括两者。`, web: true, count: 1 },
  { name: "可信上下文ID", prompt: "请读取方案1.md，告诉我同步间隔。", context: `系统项目文档目录：${JSON.stringify(catalog.map((doc) => ({ documentId: doc.id, title: doc.title })))}`, web: false, count: 1 },
  { name: "失败后重新定位", prompt: "项目文档读取刚才失败，返回：" + JSON.stringify(DOCUMENT_UNAVAILABLE_FAILURE) + "。请重新定位本项目保存的方案1.md 并告诉我同步间隔。", web: false, count: 1 },
]
for (const modelId of models) {
  for (const scenario of cases) {
    const calls = []
    const definitions = { ...buildDocumentTools({ userId: "eval", projectId: "eval", threadId: "eval", messageId: "eval" }), ...createResearchTools() }
    const tools = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, {
      ...definition,
      execute: async (input) => {
        calls.push({ name, input })
        if (name === "findProjectDocuments") return catalog.filter((doc) => !input.query || doc.title.includes(input.query))
        if (name === "readProjectDocument") {
          const doc = docs.find((item) => item.id === input.documentId)
          return doc ? { document: doc, revision: { id: doc.currentRevisionId, title: doc.title, content: doc.content, revisionNumber: 1 }, readId: crypto.randomUUID(), isCurrent: true } : DOCUMENT_UNAVAILABLE_FAILURE
        }
        if (name === "readUrl") return { ok: true, data: { url: input.url, content: "置信度表示对一次判定正确性的估计。", fullyRead: true, hasMore: false, nextCursor: null } }
        if (name === "webSearch") return { ok: true, data: { results: [{ url, title: "置信度", snippet: "定义" }] } }
        return { status: "rejected", code: "WRITES_DISABLED" }
      },
    }]))
    try {
      const result = await generateText({ model: resolveChatModel(modelId), instructions: DOCUMENT_INSTRUCTIONS + (scenario.context ? `\n${scenario.context}` : ""),
        prompt: scenario.prompt, tools, stopWhen: stepCountIs(8), maxOutputTokens: 2500, maxRetries: 0, abortSignal: AbortSignal.timeout(90_000) })
      const reads = calls.filter((call) => call.name === "readProjectDocument")
      const invalid = reads.filter((call) => !docs.some((doc) => doc.id === call.input.documentId))
      const webRead = calls.some((call) => call.name === "readUrl" && call.input.url === url)
      const passed = invalid.length === 0 && new Set(reads.map((call) => call.input.documentId)).size === scenario.count &&
        webRead === scenario.web && !calls.some((call) => call.name === "updateProjectDocument") && result.text.trim().length > 0
      console.log(JSON.stringify({ modelId, case: scenario.name, passed, invalidReads: invalid.length, tools: calls.map((call) => call.name), finishReason: result.finishReason }))
      if (!passed) process.exitCode = 1
    } catch (error) {
      // 不输出请求对象、请求头或供应商响应，避免泄露凭据。
      console.log(JSON.stringify({ modelId, case: scenario.name, passed: false, error: error.name }))
      process.exitCode = 1
    }
  }
}
