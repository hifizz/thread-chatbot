/**
 * GLM-5.2 主动 Web Search 评测。
 *
 * 路由集（只用 mock search，不消耗 Tavily credits）：
 *   node --experimental-strip-types e2e/thread-chat/verify-web-search-glm52.mjs routing
 * 真实编程集（20 次真实 Tavily 搜索，并为每题生成 no-search baseline）：
 *   node --experimental-strip-types e2e/thread-chat/verify-web-search-glm52.mjs live
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import dotenv from "dotenv"
import { generateText, isStepCount } from "ai"
import { mkdir, readFile, writeFile } from "node:fs/promises"

import {
  AUTO_WEB_SEARCH_TOOL_NAME,
  AUTO_WEB_SEARCH_MAX_CALLS,
} from "../../constants/web-search.ts"
import {
  autoWebSearchInputSchema,
  createAutoWebSearchBudget,
  createAutoWebSearchTool,
} from "../../lib/chat/auto-web-search.ts"
import { buildThreadChatSearchPolicy } from "../../lib/chat/thread-chat-search-policy.ts"
import { sanitizeSourceUrls } from "../../lib/chat/source-url-guard.ts"

dotenv.config({ path: ".env.local", quiet: true })

const mode = process.argv[2]
if (!new Set(["routing", "live"]).has(mode)) {
  console.error("用法：verify-web-search-glm52.mjs routing|live")
  process.exit(2)
}
if (!process.env.ARK_CODING_API_KEY) {
  console.log("SKIP  ARK_CODING_API_KEY 未配置")
  process.exit(0)
}
if (mode === "live" && !process.env.SEARCH_API_KEY) {
  console.log("SKIP  SEARCH_API_KEY 未配置")
  process.exit(0)
}

const provider = createOpenAICompatible({
  name: "ark-coding-web-search-eval",
  baseURL:
    process.env.ARK_CODING_BASE_URL ??
    "https://ark.cn-beijing.volces.com/api/coding/v3",
  apiKey: process.env.ARK_CODING_API_KEY,
  includeUsage: true,
})
const model = provider("glm-5.2")
const reportDir = new URL(
  "../../openspec/changes/add-proactive-web-search/research/",
  import.meta.url
)

function system(searchMode, forcedSearchCompleted = false) {
  return [
    "你是 Thread Chat 的编程助手。严格遵守下面由服务端提供的联网政策。",
    buildThreadChatSearchPolicy({
      enabled: searchMode !== "off",
      mode: searchMode,
      now: new Date(),
      timeZone: "Asia/Singapore",
      forcedSearchCompleted,
    }),
  ].join("\n\n")
}

function urlsFromText(text) {
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).map((value) =>
        value.replace(/[.,;:!?]+$/, "")
      )
    ),
  ]
}

async function executeSearchTool(searchTool, query, toolCallId, messages = []) {
  if (!searchTool.execute) throw new Error("Web Search tool has no executor")
  const output = await searchTool.execute(
    { query },
    { toolCallId, messages, context: undefined }
  )
  if (output && typeof output === "object" && Symbol.asyncIterator in output) {
    throw new Error("Web Search tool unexpectedly returned AsyncIterable")
  }
  return output
}

async function runRouting() {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/web-search-routing.json", import.meta.url),
      "utf8"
    )
  )
  const rows = []

  const caseFilter = process.env.WEB_SEARCH_EVAL_CASE
  const cases = caseFilter
    ? fixture.cases.filter((item) => item.id === caseFilter)
    : fixture.cases
  for (const item of cases) {
    if (item.expected === "reject_before_provider") {
      const input = structuredClone(item.toolInput)
      if (input.query === "__OVER_QUERY_LIMIT__") input.query = "x".repeat(401)
      const rejected = !autoWebSearchInputSchema.safeParse(input).success
      rows.push({ ...item, selected: false, passed: rejected, synthetic: true })
      console.log(`${rejected ? "PASS" : "FAIL"}  ${item.id} schema rejection`)
      continue
    }

    let providerCalls = 0
    const budget = createAutoWebSearchBudget()
    const searchTool = createAutoWebSearchTool({
      budget,
      search: async (query) => {
        providerCalls += 1
        return {
          results: [
            {
              sourceId: "src_mock",
              title: "Official documentation",
              url: "https://example.com/official-docs",
              snippet: `Mock evidence for ${query}`,
            },
          ],
          providerCredits: 0,
        }
      },
    })
    const tools =
      item.mode === "off" ? {} : { [AUTO_WEB_SEARCH_TOOL_NAME]: searchTool }
    if (item.mode === "always") {
      await executeSearchTool(searchTool, item.prompt, `forced_${item.id}`)
      rows.push({
        id: item.id,
        language: item.language,
        mode: item.mode,
        label: item.label,
        expected: item.expected,
        selected: true,
        providerCalls,
        passed: providerCalls === 1,
        serverForced: true,
      })
      console.log(
        `${providerCalls === 1 ? "PASS" : "FAIL"}  ${item.id} server_forced_search`
      )
      continue
    }
    const result = await generateText({
      model,
      system: system(item.mode),
      prompt: item.prompt,
      tools,
      toolChoice: "auto",
      stopWhen: isStepCount(1),
      maxOutputTokens: 96,
    })
    const selected = result.steps.some((step) =>
      step.toolCalls.some((call) => call.toolName === AUTO_WEB_SEARCH_TOOL_NAME)
    )
    const passed =
      item.expected === "optional" ||
      selected === (item.expected === "search")
    rows.push({
      id: item.id,
      language: item.language,
      mode: item.mode,
      label: item.label,
      expected: item.expected,
      selected,
      providerCalls,
      passed,
      usage: result.usage,
    })
    console.log(
      `${passed ? "PASS" : "FAIL"}  ${item.id} ${selected ? "search" : "no_search"}`
    )
  }

  const must = rows.filter((row) => row.label === "must_search")
  const noSearch = rows.filter((row) => row.label === "no_search")
  const requiredRows = rows.filter((row) => row.expected !== "optional")
  const autoSearchCalls = rows
    .filter((row) => row.mode === "auto" && row.selected)
    .map((row) => row.providerCalls ?? 0)
    .sort((a, b) => a - b)
  const report = {
    kind: "glm-5.2-routing",
    recordedAt: new Date().toISOString(),
    model: "glm-5.2",
    sampleCount: rows.length,
    mustSearchRecall:
      must.filter((row) => row.selected).length / Math.max(1, must.length),
    noSearchPrecision:
      noSearch.filter((row) => !row.selected).length /
      Math.max(1, noSearch.length),
    maxProviderCalls: Math.max(...rows.map((row) => row.providerCalls ?? 0)),
    medianAutoProviderCalls:
      autoSearchCalls[Math.floor(autoSearchCalls.length / 2)] ?? 0,
    allRequiredPassed: requiredRows.every((row) => row.passed),
    rows,
  }
  await mkdir(reportDir, { recursive: true })
  await writeFile(
    new URL(
      caseFilter ? `eval-routing-smoke-${caseFilter}.json` : "eval-routing-glm52.json",
      reportDir
    ),
    `${JSON.stringify(report, null, 2)}\n`
  )
  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2))
  if (
    report.mustSearchRecall < 0.9 ||
    report.noSearchPrecision < 0.9 ||
    report.maxProviderCalls > AUTO_WEB_SEARCH_MAX_CALLS ||
    report.medianAutoProviderCalls > 1 ||
    !report.allRequiredPassed
  ) {
    process.exitCode = 1
  }
}

async function runLive() {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/web-search-live-programming.json", import.meta.url),
      "utf8"
    )
  )
  const rows = []

  const caseFilter = process.env.WEB_SEARCH_EVAL_CASE
  const cases = caseFilter
    ? fixture.cases.filter((item) => item.id === caseFilter)
    : fixture.cases
  for (const item of cases) {
    const baselineStartedAt = Date.now()
    const baseline = await generateText({
      model,
      system: system("off"),
      prompt: item.prompt,
      maxOutputTokens: 700,
    })
    const baselineLatencyMs = Date.now() - baselineStartedAt

    const budget = createAutoWebSearchBudget()
    const searchTool = createAutoWebSearchTool({ budget })
    const startedAt = Date.now()
    const toolCallId = `forced_${item.id}`
    const searchOutput = await executeSearchTool(
      searchTool,
      item.prompt,
      toolCallId
    )
    const seededMessages = [
      { role: "user", content: item.prompt },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId,
            toolName: AUTO_WEB_SEARCH_TOOL_NAME,
            input: { query: item.prompt },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: AUTO_WEB_SEARCH_TOOL_NAME,
            output: { type: "json", value: searchOutput },
          },
        ],
      },
    ]
    const result = await generateText({
      model,
      system: system("always", true),
      messages: seededMessages,
      tools: { [AUTO_WEB_SEARCH_TOOL_NAME]: searchTool },
      prepareStep: () => ({ activeTools: [], toolChoice: "auto" }),
      stopWhen: isStepCount(4),
      maxOutputTokens: 1600,
    })
    const latencyMs = Date.now() - startedAt
    const outputs = [
      searchOutput,
      ...result.steps.flatMap((step) =>
        step.toolResults
          .filter(
            (toolResult) => toolResult.toolName === AUTO_WEB_SEARCH_TOOL_NAME
          )
          .map((toolResult) => toolResult.output)
      ),
    ]
    const sourceUrls = new Set(
      outputs.flatMap((output) =>
        output && typeof output === "object" && Array.isArray(output.results)
          ? output.results.map((source) => source.url)
          : []
      )
    )
    const returnedSources = outputs.flatMap((output) =>
      output && typeof output === "object" && Array.isArray(output.results)
        ? output.results.map(({ sourceId, title, url }) => ({
            sourceId,
            title,
            url,
          }))
        : []
    )
    const guardedAnswer = sanitizeSourceUrls(result.text, sourceUrls).text
    const answerUrls = urlsFromText(guardedAnswer)
    const sourceValidity = answerUrls.every((url) => sourceUrls.has(url))
    const passed =
      guardedAnswer.trim().length >= 80 &&
      sourceUrls.size > 0 &&
      answerUrls.length > 0 &&
      sourceValidity &&
      budget.startedCount <= AUTO_WEB_SEARCH_MAX_CALLS
    rows.push({
      id: item.id,
      prompt: item.prompt,
      passed,
      providerCalls: budget.startedCount,
      sourceCount: sourceUrls.size,
      returnedSources,
      citedUrlCount: answerUrls.length,
      sourceValidity,
      searchStatus: searchOutput?.status ?? "unknown",
      searchError: searchOutput?.error ?? null,
      latencyMs,
      baselineLatencyMs,
      incrementalLatencyMs: latencyMs - baselineLatencyMs,
      usage: result.usage,
      baselineUsage: baseline.usage,
      answer: guardedAnswer,
      rawAnswer: result.text,
      baselineAnswer: baseline.text,
      manualCorrectnessReview: "required",
    })
    console.log(
      `${passed ? "PASS" : "FAIL"}  ${item.id} calls=${budget.startedCount} sources=${sourceUrls.size} citations=${answerUrls.length} latency=${latencyMs}ms`
    )
  }

  const report = {
    kind: "glm-5.2-live-programming",
    recordedAt: new Date().toISOString(),
    model: "glm-5.2",
    searchProvider: "Tavily Basic Search",
    sampleCount: rows.length,
    automatedPassRate:
      rows.filter((row) => row.passed).length / Math.max(1, rows.length),
    sourceValidityRate:
      rows.filter((row) => row.sourceValidity).length / Math.max(1, rows.length),
    maxProviderCalls: Math.max(...rows.map((row) => row.providerCalls)),
    medianProviderCalls: [...rows]
      .map((row) => row.providerCalls)
      .sort((a, b) => a - b)[Math.floor(rows.length / 2)],
    averageProviderCalls:
      rows.reduce((sum, row) => sum + row.providerCalls, 0) /
      Math.max(1, rows.length),
    p50LatencyMs: [...rows]
      .map((row) => row.latencyMs)
      .sort((a, b) => a - b)[Math.floor(rows.length * 0.5)],
    p95LatencyMs: [...rows]
      .map((row) => row.latencyMs)
      .sort((a, b) => a - b)[Math.min(rows.length - 1, Math.floor(rows.length * 0.95))],
    estimatedTavilyCredits: rows.reduce(
      (sum, row) => sum + row.providerCalls,
      0
    ),
    estimatedTavilyCostUsd:
      rows.reduce((sum, row) => sum + row.providerCalls, 0) * 0.008,
    limitation:
      "Automated gates cover call bounds, returned-source validity and non-empty grounded answers. Correctness/non-regression still requires human review of answer/baselineAnswer pairs.",
    rows,
  }
  await mkdir(reportDir, { recursive: true })
  await writeFile(
    new URL(
      caseFilter
        ? `eval-live-programming-smoke-${caseFilter}.json`
        : "eval-live-programming-glm52.json",
      reportDir
    ),
    `${JSON.stringify(report, null, 2)}\n`
  )
  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2))
  if (
    report.sourceValidityRate < 1 ||
    report.maxProviderCalls > AUTO_WEB_SEARCH_MAX_CALLS
  ) {
    process.exitCode = 1
  }
}

if (mode === "routing") await runRouting()
else await runLive()
