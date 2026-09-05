import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { loadAgentCases } from "../../evals/agent/cases.ts"
import { executeFixtureCase } from "../../evals/agent/executors/fixture.ts"
import { runAgentEvaluation } from "../../evals/agent/runner.ts"
import { createAgentRunSnapshot } from "../../evals/agent/baseline.ts"
import {
  compareAgentRuns,
  formatAgentComparisonMarkdown,
} from "../../evals/agent/compare.ts"

const candidate = {
  candidate: "fixture-baseline-v1",
  model: "openrouter-gpt-5.6-luna",
  promptVersion: "thread-chat-prompt-v1",
  searchPolicyVersion: "anysearch-v1",
  searchProvider: "anysearch",
  memoryPolicyVersion: "thread-context-v1",
  contextPolicy: "fixture-context-v1",
  toolsetVersion: "thread-chat-tools-v1",
  multimodalParserVersion: "attachment-parser-v1",
  release: "baseline-v1",
  commit: "f23dedb",
  environment: "evaluation",
  evaluatorVersion: "deterministic-v1",
}

test("committed mode baselines match exact current manifests", async () => {
  const cases = await loadAgentCases()
  for (const [mode, filename] of [
    ["ci", "fixture-ci-v1.json"],
    ["scheduled", "fixture-scheduled-v1.json"],
    ["release", "fixture-v1.json"],
  ]) {
    const baseline = JSON.parse(
      await readFile(
        new URL(`../../evals/agent/baselines/${filename}`, import.meta.url),
        "utf8"
      )
    )
    const run = await runAgentEvaluation(cases, {
      mode,
      candidate,
      executor: ({ evaluationCase }) => executeFixtureCase(evaluationCase),
    })
    const snapshot = createAgentRunSnapshot({
      ...run,
      kind: "fixture",
      createdAt: baseline.createdAt,
    })
    assert.equal(snapshot.datasetRevision, baseline.datasetRevision)
    assert.equal(snapshot.candidateFingerprint, baseline.candidateFingerprint)
    assert.deepEqual(snapshot.manifest, baseline.manifest)
    assert.equal(snapshot.cases.length, baseline.cases.length)
    assert.equal(snapshot.aggregate.hardFailures, 0)
    const comparison = compareAgentRuns(baseline, snapshot)
    assert.equal(comparison.blockingRegressions.length, 0)
    assert.match(formatAgentComparisonMarkdown(comparison), /Suite summary/)
  }
})

test("comparison blocks empty, duplicate, missing, and incompatible snapshots", async () => {
  const baseline = JSON.parse(
    await readFile(
      new URL("../../evals/agent/baselines/fixture-v1.json", import.meta.url),
      "utf8"
    )
  )
  const empty = structuredClone(baseline)
  empty.cases = []
  empty.aggregate.cases = 0
  assert.throws(() => compareAgentRuns(baseline, empty), /no cases/)

  const duplicate = structuredClone(baseline)
  duplicate.cases.push(structuredClone(duplicate.cases[0]))
  duplicate.aggregate.cases += 1
  assert.throws(() => compareAgentRuns(baseline, duplicate), /duplicate/)

  const missing = structuredClone(baseline)
  missing.cases.pop()
  missing.aggregate.cases -= 1
  assert.throws(() => compareAgentRuns(baseline, missing), /manifest/)

  const incompatible = structuredClone(baseline)
  incompatible.datasetRevision = "different-dataset"
  assert.throws(
    () => compareAgentRuns(baseline, incompatible),
    /Dataset revision/
  )
})

test("a new deterministic hard failure blocks while config and cost stay visible", async () => {
  const baseline = JSON.parse(
    await readFile(
      new URL("../../evals/agent/baselines/fixture-v1.json", import.meta.url),
      "utf8"
    )
  )
  const regressed = structuredClone(baseline)
  regressed.candidateFingerprint = "candidate-regression"
  regressed.candidate.promptVersion = "thread-chat-prompt-v2"
  regressed.aggregate.hardFailures = 1
  regressed.aggregate.estimatedCostUsd = 0.25
  regressed.cases[0].hardFailures = ["expected-route"]
  regressed.cases[0].providerFailures = 1
  const comparison = compareAgentRuns(baseline, regressed)
  assert.equal(comparison.blockingRegressions.length, 1)
  assert.equal(
    comparison.configurationDelta.promptVersion.candidate,
    "thread-chat-prompt-v2"
  )
  assert.equal(comparison.aggregateDelta.estimatedCostUsd, 0.25)
  assert.equal(comparison.cases[0].providerFailureDelta, 1)
})

test("CI workflows isolate evaluation identity and retain artifacts", async () => {
  const workflows = await Promise.all(
    ["agent-evals.yml", "agent-evals-scheduled.yml"].map((name) =>
      readFile(
        new URL(`../../.github/workflows/${name}`, import.meta.url),
        "utf8"
      )
    )
  )
  for (const workflow of workflows) {
    assert.match(workflow, /AI_OBSERVABILITY_ENVIRONMENT: evaluation/)
    assert.match(workflow, /actions\/upload-artifact@v4/)
    assert.doesNotMatch(workflow, /AI_OBSERVABILITY_ENVIRONMENT: production/)
  }
  assert.match(workflows[0], /LANGFUSE_PR_EVAL_ENABLED/)
  assert.match(workflows[0], /fixture-ci-v1\.json/)
  assert.match(workflows[1], /judge-model=/)
  assert.match(workflows[1], /fixture-scheduled-v1\.json/)
})
