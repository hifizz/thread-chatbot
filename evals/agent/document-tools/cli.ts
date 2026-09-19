import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { DOCUMENT_TOOL_EVALUATION } from "@/constants/document-tool-evaluation"
import { isTokenRouterConfigured } from "@/lib/ai/llm/token-router"
import { resolveChatModel } from "@/lib/ai/llm/providers"
import { registerNodeObservability, shutdownObservability } from "@/lib/observability/register-node"
import { createEvaluationLangfuseClient, runLangfuseAgentExperiment } from "../langfuse"
import { hasHardEvaluationFailure } from "../scoring"
import { datasetRevision } from "../identity"
import { documentToolCases } from "./cases"
import { documentToolPolicy } from "./policy"
import { createDocumentCaseExecutor } from "./executor"
import { runDocumentComparison, documentComparisonMarkdown } from "./experiment"

const argument = (name: string) => process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const live = process.argv.includes("--live")
const remote = process.argv.includes("--langfuse")
const repeats = Number(argument("repeats") ?? DOCUMENT_TOOL_EVALUATION.repeats)
const models = argument("models")?.split(",").filter(Boolean) ?? [...DOCUMENT_TOOL_EVALUATION.models]
if (!Number.isInteger(repeats) || repeats < 1 || repeats > DOCUMENT_TOOL_EVALUATION.maxRepeats) throw new Error("无效 repeats")
if (!models.length || new Set(models).size !== models.length) throw new Error("模型列表必须非空且不可重复")
const cases = documentToolCases()
const policies = { baseline: await documentToolPolicy("baseline"), current: await documentToolPolicy("current") }
let commit: string
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { commit = "unknown" }

if (!live) {
  console.log(JSON.stringify({ dryRun: true, note: "未调用模型、未上传 Langfuse。添加 --live 执行，添加 --langfuse 上传实验。",
    models, repeats, cases: cases.map((item) => ({ id: item.id, input: item.input.messages, expected: item.expected })),
    plannedConversations: models.length * repeats * cases.length * 2,
    maxStepsPerConversation: DOCUMENT_TOOL_EVALUATION.maxSteps, datasetRevision: datasetRevision(cases),
    baselineCommit: policies.baseline.sourceCommit, policyFingerprints: { baseline: policies.baseline.fingerprint, current: policies.current.fingerprint },
  }, null, 2))
} else {
  if (!isTokenRouterConfigured()) throw new Error("真实评测未运行：请在当前环境配置 TOKEN_ROUTER_BASE_URL 和 TOKEN_ROUTER_API_KEY")
  for (const model of models) resolveChatModel(model)
  if (process.env.AI_OBSERVABILITY_ENVIRONMENT && process.env.AI_OBSERVABILITY_ENVIRONMENT !== "evaluation")
    throw new Error("评测须在独立进程设置 AI_OBSERVABILITY_ENVIRONMENT=evaluation")
  process.env.AI_OBSERVABILITY_ENVIRONMENT = "evaluation"
  const directory = path.resolve("evals/agent/results/local", `document-tools-${Date.now()}-${crypto.randomUUID()}`)
  let client: Awaited<ReturnType<typeof createEvaluationLangfuseClient>> | undefined
  try {
    if (remote) {
      client = await createEvaluationLangfuseClient()
      const registration = await registerNodeObservability()
      if (registration.langfuse !== "registered") throw new Error("Langfuse 遥测未成功注册，尚未开始模型调用")
    }
    await mkdir(directory, { recursive: true })
    const comparison = await runDocumentComparison({ cases, models, repeats, policies, commit,
      executor: createDocumentCaseExecutor,
      onRun: async (run) => {
        // 先保存本地证据，即使远端上传失败也能检查结果。
        const file = path.join(directory, `${run.snapshot.runId}.json`)
        await writeFile(file, JSON.stringify(run, null, 2) + "\n")
        if (client) {
          const result = await runLangfuseAgentExperiment({
            name: DOCUMENT_TOOL_EVALUATION.experimentName,
            runName: `${run.model}-${run.variant}-repeat-${run.repeat}-${run.snapshot.runId}`,
            cases, candidate: run.snapshot.candidate, results: run.results, client, maxConcurrency: 1,
          })
          if (result && typeof result === "object" && "datasetRunUrl" in result && typeof result.datasetRunUrl === "string")
            run.snapshot.experimentUrl = result.datasetRunUrl
          await writeFile(file, JSON.stringify(run, null, 2) + "\n")
        }
        console.log(JSON.stringify({ model: run.model, variant: run.variant, repeat: run.repeat,
          passed: run.results.filter((result) => !result.error && !hasHardEvaluationFailure(result)).length,
          total: run.results.length, file, experimentUrl: run.snapshot.experimentUrl }))
      },
    })
    await writeFile(path.join(directory, "comparison.json"), JSON.stringify(comparison, null, 2) + "\n")
    const markdown = documentComparisonMarkdown(comparison.summary)
    await writeFile(path.join(directory, "comparison.md"), markdown)
    console.log(markdown + `\n结果目录：${directory}`)
    if (comparison.runs.some((run) => run.results.some((result) => result.error ||
      (run.variant === "current" && hasHardEvaluationFailure(result))))) process.exitCode = 1
  } finally {
    try { await client?.flush() } finally { if (remote) await shutdownObservability() }
  }
}
