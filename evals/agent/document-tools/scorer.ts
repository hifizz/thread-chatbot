import { DOCUMENT_TOOL_EVALUATION } from "@/constants/document-tool-evaluation"
import type { AgentScorer } from "../scorers"
import { binaryScore } from "../scorers/helpers"
import { canonicalEvaluationJson } from "../fingerprint"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function answerRecord(text: string): Record<string, unknown> {
  try { return record(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))) }
  catch { return {} }
}

export const documentToolScorer: AgentScorer = ({ evaluationCase, result }) => {
  const expected = evaluationCase.expected.documentTools
  const fixture = evaluationCase.input.documentTools
  if (!expected || !fixture) throw new Error("缺少文档工具评测的题目或预期")
  const calls = result.output.toolCalls ?? []
  const reads = calls.filter((call) => call.toolName === "readProjectDocument")
  const pages = calls.filter((call) => call.toolName === "readUrl")
  const readIds = new Set(reads.filter((call) => "revision" in record(call.output)).map((call) => record(call.input).documentId))
  const urls = new Set(pages.filter((call) => record(call.output).ok === true).map((call) => record(call.input).url))
  const invalidReads = reads.filter((call) => !fixture.documents.some((doc) => doc.id === record(call.input).documentId))
  const failedKeys = new Set<string>()
  if (fixture.history === "failed-document-read") failedKeys.add(canonicalEvaluationJson({
    tool: "readProjectDocument", input: { documentId: fixture.documents[0].artifactId },
  }))
  let repeatedFailures = 0
  for (const call of calls) {
    const output = record(call.output)
    if (call.error || output.status === "error" || output.status === "rejected" || output.ok === false) {
      const key = canonicalEvaluationJson({ tool: call.toolName, input: call.input })
      if (failedKeys.has(key)) repeatedFailures++
      failedKeys.add(key)
    }
  }
  const answer = answerRecord(result.output.text)
  const facts = Object.entries(expected.answerFacts)
  const score = (name: string, passed: boolean, comment?: string) => ({
    ...binaryScore({ name, passed, severity: "hard", comment }), evaluatorVersion: DOCUMENT_TOOL_EVALUATION.evaluatorVersion,
  })
  return [
    score("document-id-source", invalidReads.length === 0, `无效项目文档 ID 调用 ${invalidReads.length} 次`),
    score("source-selection", reads.every((call) => expected.documentIds.includes(String(record(call.input).documentId))) &&
      pages.every((call) => expected.urls.includes(String(record(call.input).url))) &&
      (expected.documentIds.length > 0 || !calls.some((call) => call.toolName === "findProjectDocuments"))),
    score("required-sources-read", expected.documentIds.every((id) => readIds.has(id)) && expected.urls.every((url) => urls.has(url))),
    score("no-repeated-failure", repeatedFailures === 0, `重复失败 ${repeatedFailures} 次`),
    score("no-document-write", !calls.some((call) => call.toolName === "updateProjectDocument")),
    score("valid-tool-inputs", !calls.some((call) => call.error === "INVALID_TOOL_CALL")),
    score("answer-facts", facts.every(([key, value]) => answer[key] === value) && Object.keys(answer).length === facts.length,
      `正确字段 ${facts.filter(([key, value]) => answer[key] === value).length}/${facts.length}；要求字段与数字对应，不能只包含数字`),
  ]
}
