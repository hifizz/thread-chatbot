import assert from "node:assert/strict"
import { runPromptCacheFixtureEvaluation } from "../../evals/agent/prompt-cache-suite.ts"

const run = await runPromptCacheFixtureEvaluation()
assert.equal(run.results.length, 5)
assert.equal(run.mode, "ci")
assert.equal(run.candidate.promptCacheMode, "enabled")

for (const result of run.results) {
  const hardFailures = result.scores.filter(
    (score) => score.severity === "hard" && score.passed === false
  )
  assert.deepEqual(hardFailures, [], `hard failure in ${result.caseId}`)
  assert.equal(result.cache?.eligible, true)
  assert.equal(result.cache?.metadataExcluded, true)
  assert.equal(typeof result.cache?.requestPrefixHash, "string")
}

const hit = run.results.find((result) => result.caseId === "prompt-cache-one-quote-hit")
assert.equal(hit?.modelAttempts[0]?.cacheOutcome, "provider-hit")
assert.equal(hit?.cache?.cacheReadTokens, 11_000)

const fifty = run.results.find(
  (result) => result.caseId === "prompt-cache-fifty-quotes-budgeted"
)
assert.equal(fifty?.cache?.quoteCount, 50)

const unavailable = run.results.find(
  (result) => result.caseId === "prompt-cache-usage-unavailable"
)
assert.equal(unavailable?.modelAttempts[0]?.cacheOutcome, "usage-unavailable")
assert.equal(unavailable?.cache?.cacheReadTokens, undefined)

console.log("PASS isolated prompt cache Agent Eval suite")
