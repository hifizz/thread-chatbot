import { resolveObservabilityConfig } from "@/lib/observability/config"
import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExperimentResult } from "@/evals/agent/result"
import type { EvaluationCandidateConfig } from "@/evals/agent/fingerprint"
import { evaluationConfigFingerprint } from "@/evals/agent/fingerprint"
import { datasetRevision, stableDatasetItemId } from "@/evals/agent/identity"
import { assertEvaluationEnvironment } from "@/evals/agent/isolation"
import {
  selectRemoteEligibleCases,
  type RemoteEvaluationPolicy,
} from "@/evals/agent/remote-policy"

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
  remotePolicy?: RemoteEvaluationPolicy
}): Promise<{ revision: string; eligible: number; synced: number }> {
  const revision = datasetRevision(input.cases)
  const eligible = selectRemoteEligibleCases(input.cases, input.remotePolicy)
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
  results: readonly AgentExperimentResult[]
  client: EvaluationLangfuseClient
  maxConcurrency: number
  remotePolicy?: RemoteEvaluationPolicy
}): Promise<unknown> {
  const candidateFingerprint = evaluationConfigFingerprint(input.candidate)
  const eligibleCases = selectRemoteEligibleCases(
    input.cases,
    input.remotePolicy
  )
  const resultByCaseId = new Map(
    input.results.map((result) => [result.caseId, result])
  )
  if (resultByCaseId.size !== input.results.length) {
    throw new Error("Langfuse experiment results contain duplicate case IDs")
  }
  const runIds = new Set(input.results.map((result) => result.runId))
  if (runIds.size !== 1) {
    throw new Error("Langfuse experiment results must belong to one run")
  }
  const runId = input.results[0]?.runId
  for (const evaluationCase of eligibleCases) {
    const result = resultByCaseId.get(evaluationCase.id)
    if (!result) {
      throw new Error(
        `Langfuse experiment has no precomputed result for ${evaluationCase.id}`
      )
    }
    if (result.candidateFingerprint !== candidateFingerprint) {
      throw new Error(
        `Langfuse experiment result fingerprint mismatch for ${evaluationCase.id}`
      )
    }
  }
  try {
    return await input.client.experiment.run({
      name: input.name,
      ...(input.runName ? { runName: input.runName } : {}),
      description:
        "Thread Chat Agent evaluation from versioned repository cases",
      metadata: {
        candidate: input.candidate.candidate,
        candidateFingerprint,
        runId,
        repositoryDatasetRevision: datasetRevision(input.cases),
        environment: "evaluation",
      },
      data: eligibleCases.map((evaluationCase) => ({
        input: { evaluationCase },
        expectedOutput: evaluationCase.expected,
        metadata: {
          caseId: evaluationCase.id,
          suite: evaluationCase.suite,
          sensitivity: evaluationCase.sensitivity,
          candidate: input.candidate.candidate,
          candidateFingerprint,
          runId,
          traceId: resultByCaseId.get(evaluationCase.id)!.traceId,
        },
      })),
      task: async (item) => {
        if (!item.input)
          throw new Error("Langfuse experiment item has no input")
        const evaluationCase = item.input.evaluationCase
        const result = resultByCaseId.get(evaluationCase.id)
        return result!
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
