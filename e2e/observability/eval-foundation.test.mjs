import assert from "node:assert/strict"
import test from "node:test"
import { loadAgentCases } from "../../evals/agent/cases.ts"
import {
  canonicalEvaluationJson,
  evaluationConfigFingerprint,
} from "../../evals/agent/fingerprint.ts"
import {
  datasetRevision,
  stableDatasetItemId,
} from "../../evals/agent/identity.ts"
import {
  assertEvaluationDatabaseGuard,
  canonicalEvaluationDatabaseIdentity,
  evaluationDatabaseUrl,
} from "../../evals/agent/isolation.ts"
import {
  runLangfuseAgentExperiment,
  syncAgentCasesToLangfuse,
} from "../../evals/agent/langfuse.ts"
import {
  evaluationModeBudget,
  runAgentEvaluation,
} from "../../evals/agent/runner.ts"
import { selectAgentCases } from "../../evals/agent/selection.ts"
import {
  resolveRemoteEvaluationPolicy,
  selectRemoteEligibleCases,
} from "../../evals/agent/remote-policy.ts"
import { runProviderAttempt } from "../../lib/observability/provider-attempt.ts"
import { setAgentTraceBackendForTests } from "../../lib/observability/trace.ts"

const candidate = {
  candidate: "test",
  model: "test/model",
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
  evaluatorVersion: "e1",
}

test("case schema, selection, revision, and fingerprint are stable", async () => {
  const cases = await loadAgentCases()
  assert.ok(cases.length > 0)
  assert.ok(selectAgentCases(cases, { tags: ["smoke"] }).length >= 5)
  assert.equal(datasetRevision(cases), datasetRevision([...cases].reverse()))
  assert.equal(
    stableDatasetItemId(cases[0].id),
    `thread-chat-agent:${cases[0].id}`
  )
  assert.equal(
    evaluationConfigFingerprint(candidate),
    evaluationConfigFingerprint({
      ...candidate,
      apiKey: "secret-a",
      nested: { authorization: "secret-b" },
    })
  )
  assert.ok(
    !canonicalEvaluationJson({ apiKey: "secret-a", value: 1 }).includes(
      "secret-a"
    )
  )
})

test("runner preserves order, selection, envelope, timeout, and mode budgets", async () => {
  const cases = await loadAgentCases()
  const run = await runAgentEvaluation(cases, {
    runId: "foundation-run",
    mode: "smoke",
    candidate,
    selection: { caseIds: [cases[0].id] },
    executor: async ({ evaluationCase }) => ({
      traceId: "actual-executor-trace",
      text: evaluationCase.fixtureResult.text,
      route: evaluationCase.fixtureResult.route,
      tools: [],
      terminalState: "completed",
    }),
  })
  assert.equal(run.results.length, 1)
  assert.equal(run.results[0].schemaVersion, "agent-result-v1")
  assert.equal(run.results[0].runId, "foundation-run")
  assert.equal(run.results[0].caseId, cases[0].id)
  assert.equal(run.results[0].traceId, "actual-executor-trace")
  assert.equal(run.results[0].output.route, "answer")
  assert.deepEqual(evaluationModeBudget("release"), {
    concurrency: 1,
    timeoutMs: 300000,
  })

  const traceRuns = await Promise.all(
    ["trace-run-a", "trace-run-b"].map((runId) =>
      runAgentEvaluation(cases, {
        runId,
        mode: "smoke",
        candidate,
        selection: { caseIds: [cases[0].id] },
        executor: async ({ evaluationCase }) => ({
          text: evaluationCase.fixtureResult.text,
          tools: [],
        }),
      })
    )
  )
  assert.notEqual(
    traceRuns[0].results[0].traceId,
    traceRuns[1].results[0].traceId,
    "相同 case/candidate 的不同 run 必须生成不同 Trace"
  )

  let timeoutSignal
  let cleanupObserved = false
  const timeout = await runAgentEvaluation(cases, {
    mode: "smoke",
    candidate,
    selection: { caseIds: [cases[0].id] },
    timeoutMs: 5,
    cleanupGraceMs: 50,
    executor: ({ signal }) =>
      new Promise((resolve) => {
        timeoutSignal = signal
        signal.addEventListener(
          "abort",
          () => {
            cleanupObserved = true
            resolve({ text: "cancelled after deadline", tools: [] })
          },
          { once: true }
        )
      }),
  })
  assert.equal(timeoutSignal.aborted, true)
  assert.equal(timeoutSignal.reason.name, "TimeoutError")
  assert.equal(cleanupObserved, true)
  assert.equal(timeout.results[0].error.category, "timeout")
  assert.equal(timeout.results[0].output.terminalState, "failed")
})

test("runner collects provider attempts without leaking across concurrent cases", async () => {
  const cases = (await loadAgentCases()).slice(0, 2)
  const observation = {
    id: "provider-collector-test",
    traceId: "provider-collector-test",
    update() {},
    end() {},
  }
  setAgentTraceBackendForTests({
    runRoot(_input, fn) {
      return fn(observation)
    },
    observe(_name, _attributes, fn) {
      return fn(observation)
    },
  })
  try {
    const run = await runAgentEvaluation(cases, {
      runId: "provider-collector-run",
      mode: "release",
      candidate,
      concurrency: 2,
      executor: async ({ evaluationCase }) => {
        await new Promise((resolve) => setImmediate(resolve))
        await runProviderAttempt(
          {
            provider: evaluationCase.id,
            operation: "search",
            attemptIndex: 0,
          },
          async () => ({ results: [evaluationCase.id] }),
          ({ results }) => ({
            outcome: "success",
            resultCount: results.length,
          })
        )
        return { text: evaluationCase.fixtureResult.text, tools: [] }
      },
    })
    assert.deepEqual(
      run.results.map((result) =>
        result.providerAttempts.map((attempt) => attempt.provider)
      ),
      cases.map((evaluationCase) => [evaluationCase.id])
    )
    assert.ok(
      run.results.every(
        (result) => result.providerAttempts[0].phase === "finish"
      )
    )
  } finally {
    setAgentTraceBackendForTests(null)
  }
})

test("lifecycle database safety rejects production-shaped targets", () => {
  assert.throws(() =>
    evaluationDatabaseUrl({
      AI_OBSERVABILITY_ENVIRONMENT: "evaluation",
      EVAL_ALLOW_DATABASE_WRITES: "true",
      DATABASE_URL: "postgres://db/prod",
      EVAL_DATABASE_URL: "postgres://db/prod",
    })
  )
  assert.throws(() =>
    evaluationDatabaseUrl({
      AI_OBSERVABILITY_ENVIRONMENT: "evaluation",
      EVAL_ALLOW_DATABASE_WRITES: "true",
      EVAL_DATABASE_URL: "postgres://db/customer-production",
    })
  )
  assert.throws(() =>
    evaluationDatabaseUrl({
      AI_OBSERVABILITY_ENVIRONMENT: "evaluation",
      EVAL_ALLOW_DATABASE_WRITES: "true",
      DATABASE_URL: "postgres://user@localhost:5432/thread_chat_eval",
      EVAL_DATABASE_URL:
        "postgres://other@127.0.0.1:6543/thread_chat_eval",
    })
  )
  assert.deepEqual(
    canonicalEvaluationDatabaseIdentity(
      "postgres://user:secret@LOCALHOST:5432/thread_chat_eval_ci?ssl=true"
    ),
    { host: "loopback", database: "thread_chat_eval_ci" }
  )
  assert.equal(
    evaluationDatabaseUrl({
      AI_OBSERVABILITY_ENVIRONMENT: "evaluation",
      EVAL_ALLOW_DATABASE_WRITES: "true",
      DATABASE_URL: "postgres://db/thread_chat_prod",
      EVAL_DATABASE_URL: "postgres://db/thread_chat_eval_ci",
    }),
    "postgres://db/thread_chat_eval_ci"
  )
})

test("lifecycle database guard must match before writes", async () => {
  const token = "evaluation-guard-token-123456789"
  await assert.rejects(() =>
    assertEvaluationDatabaseGuard({
      source: { EVAL_DATABASE_GUARD_TOKEN: token },
      readGuard: async () => "different-evaluation-guard-token",
    })
  )
  await assert.rejects(() =>
    assertEvaluationDatabaseGuard({
      source: {},
      readGuard: async () => token,
    })
  )
  await assert.doesNotReject(() =>
    assertEvaluationDatabaseGuard({
      source: { EVAL_DATABASE_GUARD_TOKEN: token },
      readGuard: async () => token,
    })
  )
})

function fakeLangfuse() {
  const items = new Map()
  let flushes = 0
  let experimentRuns = 0
  let experimentData = []
  let experimentOutputs = []
  return {
    items,
    get flushes() {
      return flushes
    },
    get experimentRuns() {
      return experimentRuns
    },
    get experimentData() {
      return experimentData
    },
    get experimentOutputs() {
      return experimentOutputs
    },
    dataset: {
      async createItem(item) {
        items.set(item.id, structuredClone(item))
        return item
      },
    },
    experiment: {
      async run(config) {
        experimentRuns += 1
        experimentData = structuredClone(config.data)
        experimentOutputs = []
        for (const item of config.data) {
          experimentOutputs.push(await config.task(item))
        }
        return { experimentId: "fake-experiment" }
      },
    },
    async flush() {
      flushes += 1
    },
  }
}

test("dataset sync is idempotent, sensitivity-aware, and final-flushed", async () => {
  const base = (await loadAgentCases())[0]
  const privateCase = {
    ...base,
    id: "private-case",
    sensitivity: "authorized-private",
  }
  const client = fakeLangfuse()
  const first = await syncAgentCasesToLangfuse({
    cases: [base, privateCase],
    datasetName: "test",
    client,
  })
  const second = await syncAgentCasesToLangfuse({
    cases: [base, privateCase],
    datasetName: "test",
    client,
  })
  assert.equal(first.eligible, 1)
  assert.equal(second.eligible, 1)
  assert.equal(client.items.size, 1)
  assert.equal(client.flushes, 2)

  assert.deepEqual(
    resolveRemoteEvaluationPolicy({
      includeAuthorizedPrivateRequested: true,
      source: {},
    }),
    { includeAuthorizedPrivate: false }
  )
  assert.deepEqual(
    resolveRemoteEvaluationPolicy({
      includeAuthorizedPrivateRequested: false,
      source: { EVAL_ALLOW_PRIVATE_REMOTE: "true" },
    }),
    { includeAuthorizedPrivate: false }
  )
  const authorizedPolicy = resolveRemoteEvaluationPolicy({
    includeAuthorizedPrivateRequested: true,
    source: { EVAL_ALLOW_PRIVATE_REMOTE: "true" },
  })
  assert.deepEqual(
    selectRemoteEligibleCases([base, privateCase], authorizedPolicy).map(
      (item) => item.id
    ),
    [base.id, privateCase.id]
  )
})

test("Langfuse experiment flushes on success and remote failure", async () => {
  const cases = await loadAgentCases()
  const privateCase = {
    ...cases[0],
    id: "private-experiment-case",
    sensitivity: "authorized-private",
  }
  const client = fakeLangfuse()
  let executions = 0
  const experimentCases = [cases[0], privateCase]
  const precomputed = await runAgentEvaluation(experimentCases, {
    runId: "single-execution-run",
    mode: "release",
    candidate,
    executor: async ({ evaluationCase }) => {
      executions += 1
      return {
        text: evaluationCase.fixtureResult.text,
        tools: [],
        terminalState: "completed",
      }
    },
  })
  await runLangfuseAgentExperiment({
    name: "test",
    cases: experimentCases,
    candidate,
    results: precomputed.results,
    client,
    maxConcurrency: 1,
  })
  assert.equal(executions, experimentCases.length)
  assert.equal(client.experimentRuns, 1)
  assert.equal(client.flushes, 1)
  assert.equal(client.experimentOutputs.length, 1)
  assert.equal(
    client.experimentOutputs[0].traceId,
    precomputed.results[0].traceId
  )
  assert.ok(
    !client.experimentData.some(
      (item) => item.input.evaluationCase.id === privateCase.id
    ),
    "authorized-private case 默认不得进入 Langfuse Experiment data"
  )

  const failing = fakeLangfuse()
  failing.experiment.run = async () => {
    throw new Error("remote failed")
  }
  await assert.rejects(() =>
    runLangfuseAgentExperiment({
      name: "test-failure",
      cases: experimentCases,
      candidate,
      results: precomputed.results,
      client: failing,
      maxConcurrency: 1,
    })
  )
  assert.equal(failing.flushes, 1)
})
