import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { loadAgentCases } from "../../evals/agent/cases.ts"
import { executeFixtureCase } from "../../evals/agent/executors/fixture.ts"
import { runAgentEvaluation } from "../../evals/agent/runner.ts"
import {
  hasHardEvaluationFailure,
  scoreAgentResult,
} from "../../evals/agent/scoring.ts"
import { aggregateEvaluationResults } from "../../evals/agent/scorers/aggregate.ts"
import { calibrateJudge } from "../../evals/agent/scorers/judge.ts"
import { deterministicResearchRoute } from "../../lib/chat/research-router.ts"

const candidate = {
  candidate: "scorer-test",
  model: "fake/model",
  promptVersion: "p1",
  searchPolicyVersion: "s1",
  searchProvider: "fake",
  memoryPolicyVersion: "m1",
  contextPolicy: "c1",
  toolsetVersion: "t1",
  multimodalParserVersion: "mm1",
  release: "test",
  commit: "abc",
  environment: "evaluation",
  evaluatorVersion: "deterministic-v1",
}

test("initial cases cover all five suites and fixture smoke is deterministic", async () => {
  const cases = await loadAgentCases()
  assert.deepEqual([...new Set(cases.map((item) => item.suite))].sort(), [
    "core-answer",
    "memory-context",
    "multimodal",
    "reliability",
    "search-routing",
  ])
  assert.ok(cases.length >= 20)
  const run = await runAgentEvaluation(cases, {
    mode: "smoke",
    candidate,
    executor: ({ evaluationCase }) => executeFixtureCase(evaluationCase),
  })
  assert.ok(run.results.length < cases.length)
  assert.ok(run.results.every((result) => result.scores.length > 0))
  assert.ok(
    run.results
      .flatMap((result) => result.scores)
      .every((score) => score.deterministic)
  )
  assert.ok(run.results.every((result) => !hasHardEvaluationFailure(result)))
})

test("deterministic Search routing fixtures agree with production rules", async () => {
  const cases = (await loadAgentCases()).filter(
    (item) =>
      item.suite === "search-routing" &&
      ["fetch", "search", "research"].includes(item.expected.route)
  )
  for (const evaluationCase of cases) {
    const latest = evaluationCase.input.messages.at(-1).text
    const route = deterministicResearchRoute(latest)
    if (route) assert.equal(route.mode, evaluationCase.expected.route)
  }
})

test("cross-project leak is a hard failure that a high judge score cannot hide", async () => {
  const evaluationCase = (await loadAgentCases()).find(
    (item) => item.id === "memory-cross-project-no-leak"
  )
  const result = {
    schemaVersion: "agent-result-v1",
    runId: "scorer-test-run",
    caseId: evaluationCase.id,
    suite: evaluationCase.suite,
    candidate: "bad",
    candidateFingerprint: "fingerprint",
    datasetRevision: "revision",
    traceId: "trace",
    output: {
      text: "泄漏值是 SECRET-CUSTOMER-OMEGA，但回答很流畅。",
      tools: [],
      terminalState: "completed",
    },
    timing: {
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:00.010Z",
      durationMs: 10,
    },
    usage: {},
    providerAttempts: [],
    scores: [],
  }
  const scored = await scoreAgentResult({ evaluationCase, result })
  scored.scores.push({
    name: "judge:helpfulness",
    value: 1,
    deterministic: false,
    severity: "quality",
    signal: "judge",
    evaluatorVersion: "fake-judge-v1",
  })
  assert.equal(hasHardEvaluationFailure(scored), true)
  assert.equal(
    scored.scores.find((score) =>
      score.name.startsWith("cross-project-no-leak")
    ).passed,
    false
  )
  assert.ok(!scored.scores.some((score) => score.name === "product-feedback"))
})

test("search scorer keeps live Web volatility separate from citation checks", async () => {
  const cases = await loadAgentCases()
  const run = await runAgentEvaluation(cases, {
    mode: "release",
    candidate,
    selection: { caseIds: ["search-current-freshness"] },
    executor: ({ evaluationCase }) => executeFixtureCase(evaluationCase),
  })
  const scores = run.results[0].scores
  assert.equal(
    scores.find((score) => score.name === "citation-presence").passed,
    true
  )
  assert.equal(
    scores.find((score) => score.name === "live-web-volatility").value,
    "variable"
  )
})

test("aggregate report exposes dimensions without an opaque overall score", async () => {
  const cases = await loadAgentCases()
  const run = await runAgentEvaluation(cases, {
    mode: "smoke",
    candidate,
    executor: ({ evaluationCase }) => executeFixtureCase(evaluationCase),
  })
  const aggregate = aggregateEvaluationResults(run.results)
  assert.ok(aggregate.p95LatencyMs >= aggregate.p50LatencyMs)
  assert.equal(aggregate.hardFailures, 0)
  assert.ok("fallbackRate" in aggregate)
  assert.ok("emptyOutputRate" in aggregate)
  assert.ok(!("overallScore" in aggregate))
})

test("judge calibration uses the committed multi-dimension human labels", async () => {
  const samples = JSON.parse(
    await readFile(
      new URL(
        "../../evals/agent/fixtures/judge-calibration.json",
        import.meta.url
      ),
      "utf8"
    )
  )
  assert.deepEqual(
    [...new Set(samples.map((sample) => sample.dimension))].sort(),
    [
      "citationSupport",
      "completeness",
      "correctness",
      "faithfulness",
      "helpfulness",
    ]
  )
  const calibration = calibrateJudge(samples)
  assert.equal(calibration.samples, 5)
  assert.ok(calibration.meanAbsoluteError > 0)
  assert.ok(calibration.withinPointTwoRate >= 0.8)
})
