import assert from "node:assert/strict"
import test from "node:test"
import { MockLanguageModelV3 } from "ai/test"
import { asSchema } from "ai"
import { documentToolCases } from "../../evals/agent/document-tools/cases.ts"
import { documentToolPolicy } from "../../evals/agent/document-tools/policy.ts"
import { documentToolMessages, createDocumentCaseExecutor } from "../../evals/agent/document-tools/executor.ts"
import { documentToolScorer } from "../../evals/agent/document-tools/scorer.ts"
import { documentCandidate, runDocumentComparison } from "../../evals/agent/document-tools/experiment.ts"
import { runAgentEvaluation } from "../../evals/agent/runner.ts"
import { deterministicScorer } from "../../evals/agent/scorers/index.ts"
import { hasHardEvaluationFailure } from "../../evals/agent/scoring.ts"
import { runLangfuseAgentExperiment } from "../../evals/agent/langfuse.ts"
import { datasetRevision } from "../../evals/agent/identity.ts"

const cases = documentToolCases()
const policies = { baseline: await documentToolPolicy("baseline"), current: await documentToolPolicy("current") }
const candidate = documentCandidate("mock-model", policies.current, "test-commit")

function goodOutput(item) {
  const expectation = item.expected.documentTools
  const toolCalls = [
    ...expectation.documentIds.map((id, index) => ({ toolCallId: `doc-${index}`, toolName: "readProjectDocument", input: { documentId: id }, output: { revision: { content: "合成正文" } } })),
    ...expectation.urls.map((url, index) => ({ toolCallId: `web-${index}`, toolName: "readUrl", input: { url }, output: { ok: true } })),
  ]
  return { text: JSON.stringify(expectation.answerFacts), tools: toolCalls.map((call) => call.toolName), toolCalls, terminalState: "completed", finishReason: "stop" }
}
function scores(item, output) {
  return documentToolScorer({ evaluationCase: item, result: { output } })
}
function passed(item, output, name) {
  return scores(item, output).find((score) => score.name === name).passed
}

test("六个场景稳定可复现；答案与正文进入题集指纹，但不泄漏给模型", () => {
  assert.equal(cases.length, 6)
  assert.equal(datasetRevision(cases), datasetRevision(documentToolCases()))
  const changed = structuredClone(cases)
  changed[0].input.documentTools.page.content += "修改"
  assert.notEqual(datasetRevision(changed), datasetRevision(cases))
  const webHistory = documentToolMessages(cases[1], policies.current)
  assert.ok(webHistory.some((message) => message.role === "tool"))
  assert.match(JSON.stringify(webHistory), /docId/)
  assert.ok(!JSON.stringify(webHistory).includes('阈值是 86'))
  const oldFailure = documentToolMessages(cases[5], policies.baseline)
  const newFailure = documentToolMessages(cases[5], policies.current)
  assert.equal(oldFailure[2].content[0].output.type, "error-text")
  assert.equal(newFailure[2].content[0].output.value.code, "DOCUMENT_UNAVAILABLE")
})

test("旧版提示词和参数来源冻结；新旧定义没有生产 execute，参数仍受校验", async () => {
  assert.notEqual(policies.baseline.fingerprint, policies.current.fingerprint)
  assert.equal(policies.baseline.sourceCommit, "142e6a7911509e9aa336fa58fc0aa1555971c852")
  for (const policy of Object.values(policies)) {
    assert.equal(policy.tools.readProjectDocument.execute, undefined)
    const schema = asSchema(policy.tools.readProjectDocument.inputSchema)
    assert.equal((await schema.validate({ documentId: "https://example.com" })).success, false)
  }
  const oldSchema = await asSchema(policies.baseline.tools.readProjectDocument.inputSchema).jsonSchema
  const newSchema = await asSchema(policies.current.tools.readProjectDocument.inputSchema).jsonSchema
  assert.equal(oldSchema.properties.documentId.description, undefined)
  assert.match(newSchema.properties.documentId.description, /不是 artifactId/)
})

test("事实检查拒绝漏项、对错文档、只输出数字、正确数字但错误单位/类型", () => {
  const item = cases[2]
  const good = goodOutput(item)
  assert.ok(scores(item, good).every((score) => score.passed))
  const swapped = { ...item.expected.documentTools.answerFacts, syncMinutes1: 23, syncMinutes2: 17 }
  for (const text of [JSON.stringify(swapped), "17,23,41,59,67,83,97", '{"syncMinutes1":17}', JSON.stringify({ ...item.expected.documentTools.answerFacts, syncMinutes1: "17小时" })])
    assert.equal(passed(item, { ...good, text }, "answer-facts"), false)
  assert.equal(passed(item, { ...good, text: "```json\n" + good.text + "\n```" }, "answer-facts"), true)
})

test("不调用工具或只读六份不算完成；网页场景误调项目工具也不通过", () => {
  assert.equal(passed(cases[0], { ...goodOutput(cases[0]), toolCalls: [] }, "required-sources-read"), false)
  const seven = goodOutput(cases[2])
  seven.toolCalls.pop()
  assert.equal(passed(cases[2], seven, "required-sources-read"), false)
  const web = goodOutput(cases[0])
  web.toolCalls.push({ toolName: "findProjectDocuments", input: {} })
  assert.equal(passed(cases[0], web, "source-selection"), false)
})

test("缓存仍然算重复错误调用；任意写入意图和 SDK 拒绝的参数均计分", () => {
  const item = cases[5]
  const output = goodOutput(item)
  const wrong = { toolName: "readProjectDocument", input: { documentId: item.input.documentTools.page.snapshotId }, output: { status: "error" } }
  output.toolCalls.push(wrong, wrong, { toolName: "updateProjectDocument", input: {}, error: "INVALID_TOOL_CALL" })
  for (const name of ["document-id-source", "no-repeated-failure", "no-document-write", "valid-tool-inputs"])
    assert.equal(passed(item, output, name), false)
})

test("只重试一次历史里已失败的 Artifact ID，也算重复失败", () => {
  const item = cases[5]
  const output = goodOutput(item)
  output.toolCalls.push({ toolName: "readProjectDocument", input: { documentId: item.input.documentTools.documents[0].artifactId }, output: { status: "error" } })
  assert.equal(passed(item, output, "no-repeated-failure"), false)
})

const generation = (content, reason = "stop") => ({ content, finishReason: { unified: reason, raw: reason }, warnings: [],
  usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } })
const toolCall = (toolName, input, toolCallId) => ({ type: "tool-call", toolName, input: JSON.stringify(input), toolCallId })

test("真实 SDK 多步循环：读网页后回答，保存调用参数与结果；旧版才返回 docId", async () => {
  for (const policy of Object.values(policies)) {
    const model = new MockLanguageModelV3({ doGenerate: [
      generation([toolCall("readUrl", { url: cases[0].input.documentTools.page.url }, "web")], "tool-calls"),
      generation([{ type: "text", text: '{"confidenceThresholdPercent":86}' }]),
    ] })
    const output = await createDocumentCaseExecutor(policy, model)({ evaluationCase: cases[0], candidate, signal: new AbortController().signal, traceId: "a".repeat(32) })
    assert.ok(scores(cases[0], output).every((score) => score.passed))
    assert.equal(output.toolCalls.length, 1)
    assert.equal("docId" in output.toolCalls[0].output.data, policy.variant === "baseline")
    assert.equal(output.usage.inputTokens, 20)
  }
})

test("真实 SDK 的 schema 失败不会漏记；纠正 ID 后可以完成但首次误调仍扣分", async () => {
  const item = cases[4]
  const model = new MockLanguageModelV3({ doGenerate: [
    generation([toolCall("readProjectDocument", { documentId: "bad-id" }, "bad")], "tool-calls"),
    generation([toolCall("readProjectDocument", { documentId: item.input.documentTools.documents[0].id }, "good")], "tool-calls"),
    generation([{ type: "text", text: '{"syncMinutes1":17}' }]),
  ] })
  const output = await createDocumentCaseExecutor(policies.current, model)({ evaluationCase: item, candidate, signal: new AbortController().signal, traceId: "b".repeat(32) })
  assert.equal(output.toolCalls.length, 2)
  assert.equal(output.toolCalls[0].error, "INVALID_TOOL_CALL")
  assert.equal(passed(item, output, "valid-tool-inputs"), false)
  assert.equal(passed(item, output, "required-sources-read"), true)
})

test("重复运行使用同一题集且 Trace 唯一，新旧交替；Langfuse 收到各次的分数和调用证据", async () => {
  let remoteRuns = 0, flushes = 0
  const calls = []
  const comparison = await runDocumentComparison({ cases, models: ["mock-model"], repeats: 3, policies, commit: "test-commit",
    executor: (policy) => async ({ evaluationCase }) => {
      calls.push(policy.variant)
      const output = goodOutput(evaluationCase)
      if (policy.variant === "baseline") output.text = "错误答案"
      return output
    },
    onRun: async (run) => {
      await runLangfuseAgentExperiment({ name: "document-tools", cases, candidate: run.snapshot.candidate, results: run.results, maxConcurrency: 1,
        client: { flush: async () => { flushes++ }, experiment: { run: async (options) => {
          remoteRuns++
          assert.equal(options.data.length, 6)
          const result = await options.task(options.data[0])
          assert.ok(result.output.toolCalls.length > 0)
          const remoteScores = await options.evaluators[0]({ output: result })
          assert.ok(remoteScores.some((score) => score.name === "answer-facts"))
          return { datasetRunUrl: "https://example.com/experiment" }
        } } },
      })
    },
  })
  assert.equal(remoteRuns, 6)
  assert.equal(flushes, 6)
  assert.equal(comparison.comparisons.length, 3)
  assert.equal(new Set(comparison.runs.flatMap((run) => run.results.map((item) => item.traceId))).size, 36)
  assert.equal(new Set(comparison.runs.map((run) => run.snapshot.datasetRevision)).size, 1)
  assert.deepEqual(comparison.runs.map((run) => run.variant), ["baseline", "current", "current", "baseline", "baseline", "current"])
  assert.equal(comparison.summary.find((row) => row.variant === "baseline").passed, 0)
  assert.equal(comparison.summary.find((row) => row.variant === "current").passed, 18)
})

test("超时和基础设施错误不能被判成通过", async () => {
  const run = await runAgentEvaluation(cases, { mode: "smoke", selection: { caseIds: [cases[0].id] }, candidate,
    executor: async () => { throw new Error("provider unavailable") }, scorers: [deterministicScorer, documentToolScorer] })
  assert.ok(run.results[0].error)
  assert.ok(hasHardEvaluationFailure(run.results[0]))
})
