import { DOCUMENT_TOOL_EVALUATION } from "@/constants/document-tool-evaluation"
import { createAgentRunSnapshot, type AgentRunSnapshot } from "../baseline"
import { compareAgentRuns } from "../compare"
import type { EvaluationCandidateConfig } from "../fingerprint"
import { runAgentEvaluation, type AgentCaseExecutor } from "../runner"
import { deterministicScorer } from "../scorers"
import { hasHardEvaluationFailure } from "../scoring"
import type { AgentCase } from "../schema"
import type { AgentExperimentResult } from "../result"
import type { DocumentPolicy, DocumentToolPolicy } from "./policy"
import { documentToolScorer } from "./scorer"

export type DocumentExperimentRun = {
  model: string
  variant: DocumentPolicy
  repeat: number
  snapshot: AgentRunSnapshot
  results: AgentExperimentResult[]
}

export function documentCandidate(model: string, policy: DocumentToolPolicy, commit: string): EvaluationCandidateConfig {
  return {
    candidate: `document-tools-${policy.variant}`, model, promptVersion: policy.fingerprint,
    toolsetVersion: policy.fingerprint, searchPolicyVersion: "synthetic-fixed-page-v1", searchProvider: "simulated",
    memoryPolicyVersion: "native-tool-history-v1", contextPolicy: DOCUMENT_TOOL_EVALUATION.contextPolicy,
    multimodalParserVersion: "not-used", release: policy.variant,
    commit: policy.variant === "baseline" ? policy.sourceCommit : commit, environment: "evaluation",
    evaluatorVersion: DOCUMENT_TOOL_EVALUATION.evaluatorVersion,
    generation: { maxSteps: DOCUMENT_TOOL_EVALUATION.maxSteps, maxOutputTokens: DOCUMENT_TOOL_EVALUATION.maxOutputTokens, maxRetries: 0 },
    execution: "real-model-simulated-tools",
  }
}

export async function runDocumentComparison(input: {
  cases: AgentCase[]
  models: string[]
  repeats: number
  policies: Record<DocumentPolicy, DocumentToolPolicy>
  commit: string
  executor: (policy: DocumentToolPolicy) => AgentCaseExecutor
  onRun?: (run: DocumentExperimentRun) => Promise<void>
}) {
  if (!Number.isInteger(input.repeats) || input.repeats < 1 || input.repeats > DOCUMENT_TOOL_EVALUATION.maxRepeats)
    throw new Error(`repeats 必须为 1–${DOCUMENT_TOOL_EVALUATION.maxRepeats} 的整数`)
  if (!input.models.length || new Set(input.models).size !== input.models.length) throw new Error("模型列表必须非空且不可重复")
  const runs: DocumentExperimentRun[] = []
  const comparisons = []
  for (const model of input.models) {
    for (let repeat = 1; repeat <= input.repeats; repeat++) {
      // 交替运行顺序，减少总是先跑旧版带来的时间偏差。
      const order: DocumentPolicy[] = repeat % 2 ? ["baseline", "current"] : ["current", "baseline"]
      const pair = {} as Record<DocumentPolicy, DocumentExperimentRun>
      for (const variant of order) {
        const run = await runAgentEvaluation(input.cases, {
          mode: "scheduled", selection: { caseIds: input.cases.map((item) => item.id) },
          candidate: documentCandidate(model, input.policies[variant], input.commit),
          executor: input.executor(input.policies[variant]), concurrency: 1, timeoutMs: DOCUMENT_TOOL_EVALUATION.timeoutMs,
          scorers: [deterministicScorer, documentToolScorer],
        })
        const entry: DocumentExperimentRun = { model, variant, repeat,
          snapshot: createAgentRunSnapshot({ ...run, kind: "live" }), results: run.results }
        await input.onRun?.(entry)
        runs.push(entry)
        pair[variant] = entry
      }
      comparisons.push({ model, repeat, ...compareAgentRuns(pair.baseline.snapshot, pair.current.snapshot) })
    }
  }
  return { runs, comparisons, summary: summarizeDocumentRuns(runs) }
}

export function summarizeDocumentRuns(runs: DocumentExperimentRun[]) {
  const groups = new Map<string, { model: string; variant: DocumentPolicy; results: AgentExperimentResult[] }>()
  for (const run of runs) {
    const key = JSON.stringify([run.model, run.variant])
    const group = groups.get(key) ?? { model: run.model, variant: run.variant, results: [] }
    group.results.push(...run.results)
    groups.set(key, group)
  }
  return [...groups.values()].map(({ results, ...group }) => ({
    ...group, total: results.length,
    passed: results.filter((result) => !result.error && !hasHardEvaluationFailure(result)).length,
    executionErrors: results.filter((result) => result.error).length,
    scores: Object.fromEntries([...new Set(results.flatMap((result) => result.scores.map((score) => score.name)))].map((name) => {
      const scores = results.flatMap((result) => result.scores.filter((score) => score.name === name))
      return [name, { passed: scores.filter((score) => score.passed === true).length, total: scores.length }]
    })),
    failedCases: results.filter((result) => result.error || hasHardEvaluationFailure(result)).map((result) => ({
      caseId: result.caseId, runId: result.runId, traceId: result.traceId,
      failures: result.scores.filter((score) => score.passed === false).map((score) => score.name),
      ...(result.error ? { error: result.error.category } : {}),
    })),
  }))
}

export function documentComparisonMarkdown(summary: ReturnType<typeof summarizeDocumentRuns>): string {
  const scoreCell = (item: typeof summary[number], name: string) => {
    const score = item.scores[name]
    return score ? `${score.passed}/${score.total}` : "未评测"
  }
  return [
    "# 项目文档工具评测", "", "真实模型 + 合成资料 + 模拟工具；不代表数据库或完整生产链路验收。表格是通过次数/样本数。", "",
    "| 模型 | 版本 | 全部通过 | ID 来源正确 | 所需资料读齐 | 无重复失败 | 答案事实正确 | 执行异常 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.map((item) => `| ${item.model} | ${item.variant} | ${item.passed}/${item.total} | ${scoreCell(item, "document-id-source")} | ${scoreCell(item, "required-sources-read")} | ${scoreCell(item, "no-repeated-failure")} | ${scoreCell(item, "answer-facts")} | ${item.executionErrors} |`),
    "", "baseline 为修复前文档工具协议快照；current 为运行时工作区协议。两者使用相同资料、模型和预算，未通过不等于提示词问题，请查看完整调用记录。",
    "样本量较小，不代表线上故障率；JSON 数值核对只检查这些合成题的事实，不评价开放式回答质量。", "",
  ].join("\n")
}
