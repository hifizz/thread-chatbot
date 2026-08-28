import { resolveObservabilityConfig } from "@/lib/observability/config"
import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExperimentResult } from "@/evals/agent/result"
import type { AgentCaseExecutor } from "@/evals/agent/runner"
import type { EvaluationCandidateConfig } from "@/evals/agent/fingerprint"
import { evaluationConfigFingerprint } from "@/evals/agent/fingerprint"
import { datasetRevision, stableDatasetItemId } from "@/evals/agent/identity"
import { assertEvaluationEnvironment } from "@/evals/agent/isolation"

export type EvaluationLangfuseClient = {
  dataset: {
    createItem: (input: {
      datasetName: string
      id: string
      input: unknown
      expectedOutput: unknown
      metadata: unknown
    }) => Promise<unknown>
  }
  experiment: {
    run: (input: {
      name: string
      runName?: string
      description?: string
      metadata?: Record<string, unknown>
      data: Array<{
        input: { evaluationCase: AgentCase }
        expectedOutput: AgentCase["expected"]
        metadata: Record<string, unknown>
      }>
      task: (item: {
        input?: { evaluationCase: AgentCase }
      }) => Promise<AgentExperimentResult>
      evaluators: Array<
        (input: { output: AgentExperimentResult }) => Promise<
          Array<{
            name: string
            value: number | string
            dataType?: "NUMERIC" | "CATEGORICAL"
          }>
        >
      >
      maxConcurrency: number
    }) => Promise<unknown>
  }
  flush: () => Promise<void>
}

export async function createEvaluationLangfuseClient(): Promise<EvaluationLangfuseClient> {
  assertEvaluationEnvironment()
  const config = resolveObservabilityConfig()
  if (
    !config.langfuseEnabled ||
    !config.langfusePublicKey ||
    !config.langfuseSecretKey
  ) {
    throw new Error("Langfuse is not configured for the evaluation environment")
  }
  const { LangfuseClient } = await import("@langfuse/client")
  return new LangfuseClient({
    publicKey: config.langfusePublicKey,
    secretKey: config.langfuseSecretKey,
    ...(config.langfuseBaseUrl ? { baseUrl: config.langfuseBaseUrl } : {}),
  }) as unknown as EvaluationLangfuseClient
}

export async function syncAgentCasesToLangfuse(input: {
  cases: readonly AgentCase[]
  datasetName: string
  client: EvaluationLangfuseClient
  dryRun?: boolean
  includeAuthorizedPrivate?: boolean
}): Promise<{ revision: string; eligible: number; synced: number }> {
  const revision = datasetRevision(input.cases)
  const eligible = input.cases.filter(
    (item) =>
      item.sensitivity !== "authorized-private" ||
      input.includeAuthorizedPrivate === true
  )
  let synced = 0
  try {
    if (!input.dryRun) {
      for (const evaluationCase of eligible) {
        await input.client.dataset.createItem({
          datasetName: input.datasetName,
          id: stableDatasetItemId(evaluationCase.id),
          input: evaluationCase.input,
          expectedOutput: evaluationCase.expected,
          metadata: {
            caseId: evaluationCase.id,
            suite: evaluationCase.suite,
            tags: evaluationCase.tags,
            sensitivity: evaluationCase.sensitivity,
            schemaVersion: evaluationCase.schemaVersion,
            repositoryDatasetRevision: revision,
          },
        })
        synced += 1
      }
    }
    return { revision, eligible: eligible.length, synced }
  } finally {
    await input.client.flush()
  }
}

export async function runLangfuseAgentExperiment(input: {
  name: string
  runName?: string
  cases: readonly AgentCase[]
  candidate: EvaluationCandidateConfig
  execute: AgentCaseExecutor
  client: EvaluationLangfuseClient
  maxConcurrency: number
}): Promise<unknown> {
  const candidateFingerprint = evaluationConfigFingerprint(input.candidate)
  try {
    return await input.client.experiment.run({
      name: input.name,
      ...(input.runName ? { runName: input.runName } : {}),
      description:
        "Thread Chat Agent evaluation from versioned repository cases",
      metadata: {
        candidate: input.candidate.candidate,
        candidateFingerprint,
        repositoryDatasetRevision: datasetRevision(input.cases),
        environment: "evaluation",
      },
      data: input.cases.map((evaluationCase) => ({
        input: { evaluationCase },
        expectedOutput: evaluationCase.expected,
        metadata: {
          caseId: evaluationCase.id,
          suite: evaluationCase.suite,
          candidate: input.candidate.candidate,
          candidateFingerprint,
        },
      })),
      task: async (item) => {
        if (!item.input)
          throw new Error("Langfuse experiment item has no input")
        const evaluationCase = item.input.evaluationCase
        const { runAgentEvaluation } = await import("@/evals/agent/runner")
        const run = await runAgentEvaluation(input.cases, {
          mode: "release",
          candidate: input.candidate,
          executor: input.execute,
          concurrency: 1,
          selection: { caseIds: [evaluationCase.id] },
        })
        return run.results[0]
      },
      evaluators: [
        async ({ output }) =>
          output.scores.map((score) => ({
            name: score.name,
            value: score.value,
            dataType:
              typeof score.value === "number"
                ? ("NUMERIC" as const)
                : ("CATEGORICAL" as const),
          })),
      ],
      maxConcurrency: input.maxConcurrency,
    })
  } finally {
    await input.client.flush()
  }
}
