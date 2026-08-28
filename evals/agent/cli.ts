import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/model"
import { OBSERVABILITY_POLICY_VERSIONS } from "@/constants/observability"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createAgentRunSnapshot } from "@/evals/agent/baseline"
import { AGENT_EVAL_ROOT, loadAgentCases } from "@/evals/agent/cases"
import { executeProductionContentCase } from "@/evals/agent/executors/content"
import { executeFixtureCase } from "@/evals/agent/executors/fixture"
import { executeLifecycleCase } from "@/evals/agent/executors/lifecycle"
import type { EvaluationCandidateConfig } from "@/evals/agent/fingerprint"
import {
  createEvaluationLangfuseClient,
  runLangfuseAgentExperiment,
  syncAgentCasesToLangfuse,
} from "@/evals/agent/langfuse"
import {
  runAgentEvaluation,
  type AgentCaseExecutor,
  type EvaluationRunMode,
} from "@/evals/agent/runner"
import type { AgentSuite } from "@/evals/agent/schema"
import { aggregateEvaluationResults } from "@/evals/agent/scorers/aggregate"
import { runModelJudge } from "@/evals/agent/scorers/judge"
import {
  DEFAULT_AGENT_SCORERS,
  hasHardEvaluationFailure,
} from "@/evals/agent/scoring"

function argument(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
}

function listArgument(name: string): string[] | undefined {
  const value = argument(name)
  return value?.split(",").filter(Boolean)
}

const mode = (argument("mode") ?? "smoke") as EvaluationRunMode
if (!(["smoke", "ci", "scheduled", "release"] as string[]).includes(mode)) {
  throw new Error(`Unknown evaluation mode: ${mode}`)
}
const executorMode = argument("executor") ?? "fixture"
if (!(["fixture", "declared"] as string[]).includes(executorMode)) {
  throw new Error(`Unknown executor mode: ${executorMode}`)
}

const model =
  argument("model") ?? process.env.EVAL_MODEL_ID ?? DEFAULT_THREAD_CHAT_MODEL_ID
const candidate: EvaluationCandidateConfig = {
  candidate:
    argument("candidate") ?? process.env.EVAL_CANDIDATE ?? "local-current",
  model,
  promptVersion: OBSERVABILITY_POLICY_VERSIONS.prompt,
  searchPolicyVersion: OBSERVABILITY_POLICY_VERSIONS.search,
  searchProvider: process.env.EVAL_SEARCH_PROVIDER ?? "anysearch",
  memoryPolicyVersion: OBSERVABILITY_POLICY_VERSIONS.memory,
  contextPolicy: "production-compile-model-context-v1",
  toolsetVersion: OBSERVABILITY_POLICY_VERSIONS.toolset,
  multimodalParserVersion: OBSERVABILITY_POLICY_VERSIONS.multimodalParser,
  release: process.env.AI_OBSERVABILITY_RELEASE ?? "local",
  commit: process.env.GIT_COMMIT_SHA ?? "working-tree",
  environment: "evaluation",
  evaluatorVersion: "deterministic-v1",
}
const cases = await loadAgentCases()

const declaredExecutor: AgentCaseExecutor = async (input) => {
  switch (input.evaluationCase.execution) {
    case "fixture":
      return executeFixtureCase(input.evaluationCase)
    case "content":
      return executeProductionContentCase({
        evaluationCase: input.evaluationCase,
        modelId: input.candidate.model,
        traceId: input.traceId,
        candidate: input.candidate.candidate,
      })
    case "lifecycle":
      return executeLifecycleCase({
        evaluationCase: input.evaluationCase,
        modelId: input.candidate.model,
      })
  }
}

const executor: AgentCaseExecutor =
  executorMode === "declared"
    ? declaredExecutor
    : ({ evaluationCase }) => executeFixtureCase(evaluationCase)

if (process.argv.includes("--sync-dataset")) {
  const client = await createEvaluationLangfuseClient()
  const sync = await syncAgentCasesToLangfuse({
    cases,
    datasetName: argument("dataset") ?? "thread-chat-agent",
    client,
    dryRun: !process.argv.includes("--execute"),
  })
  console.log(JSON.stringify({ operation: "dataset-sync", ...sync }, null, 2))
  process.exit(0)
}

const selection = {
  suites: listArgument("suite") as AgentSuite[] | undefined,
  tags: listArgument("tag"),
  caseIds: listArgument("case"),
}
const hasExplicitSelection = Object.values(selection).some(
  (value) => value !== undefined
)
const judgeModelId = argument("judge-model")
const run = await runAgentEvaluation(cases, {
  mode,
  candidate,
  ...(hasExplicitSelection ? { selection } : {}),
  executor,
  ...(judgeModelId
    ? {
        scorers: [
          ...DEFAULT_AGENT_SCORERS,
          ({ evaluationCase, result }) =>
            runModelJudge({
              evaluationCase,
              result,
              judgeModelId,
            }),
        ],
      }
    : {}),
})

let experimentUrl: string | null = null
if (process.argv.includes("--langfuse-experiment")) {
  const selectedIds = new Set(run.results.map((result) => result.caseId))
  const selectedCases = cases.filter((item) => selectedIds.has(item.id))
  const client = await createEvaluationLangfuseClient()
  const remote = await runLangfuseAgentExperiment({
    name: argument("experiment") ?? `thread-chat-agent-${mode}`,
    runName: argument("run-name"),
    cases: selectedCases,
    candidate,
    execute: executor,
    client,
    maxConcurrency: mode === "release" ? 1 : 2,
  })
  if (
    remote &&
    typeof remote === "object" &&
    "datasetRunUrl" in remote &&
    typeof remote.datasetRunUrl === "string"
  ) {
    experimentUrl = remote.datasetRunUrl
  }
}

const snapshot = createAgentRunSnapshot({
  ...run,
  kind: executorMode === "declared" ? "live" : "fixture",
  experimentUrl,
})
const snapshotArgument = argument("write-snapshot")
if (snapshotArgument) {
  const output = path.resolve(snapshotArgument)
  const allowedRoot = path.join(AGENT_EVAL_ROOT, "results", "local")
  if (!output.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(
      "Snapshots may only be written under evals/agent/results/local"
    )
  }
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`)
}

console.log(
  JSON.stringify(
    { ...run, aggregate: aggregateEvaluationResults(run.results), snapshot },
    null,
    2
  )
)
if (
  run.results.some((result) => result.error || hasHardEvaluationFailure(result))
) {
  process.exitCode = 1
}
