import assert from "node:assert/strict"
import test from "node:test"
import { assistantMessageTraceId } from "../../lib/observability/identity.ts"
import { evaluateObservabilityReleaseReadiness } from "../../lib/observability/release-readiness.ts"
import {
  registerNodeObservability,
  resetObservabilityRegistrationForTests,
} from "../../lib/observability/register-node.ts"

function deployedSource(baseUrl) {
  return {
    NODE_ENV: "production",
    AI_TELEMETRY_ENABLED: "true",
    AI_LANGFUSE_ENABLED: "true",
    AI_TELEMETRY_RECORD_CONTENT: "false",
    AI_DEVTOOLS_ENABLED: "true",
    AI_OBSERVABILITY_ENVIRONMENT: "staging",
    AI_OBSERVABILITY_RELEASE: "git-sha-abc123",
    AI_OBSERVABILITY_ID_SALT: "test-only-high-entropy-salt",
    LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    LANGFUSE_SECRET_KEY: "sk-lf-test",
    LANGFUSE_BASE_URL: baseUrl,
  }
}

test("deployed readiness reports metadata-only without exposing credentials", () => {
  const report = evaluateObservabilityReleaseReadiness(
    deployedSource("https://us.cloud.langfuse.com")
  )
  assert.equal(report.ready, true)
  assert.equal(report.metadataOnly, true)
  assert.equal(report.endpointOrigin, "https://us.cloud.langfuse.com")
  assert.ok(!JSON.stringify(report).includes("sk-lf-test"))
})

test("content capture, missing salt, local release, and insecure endpoint fail closed", () => {
  const source = deployedSource("http://langfuse.internal:3000")
  source.AI_TELEMETRY_RECORD_CONTENT = "true"
  source.AI_OBSERVABILITY_ID_SALT = ""
  source.AI_OBSERVABILITY_RELEASE = "local"
  const report = evaluateObservabilityReleaseReadiness(source)
  assert.equal(report.ready, false)
  assert.deepEqual(
    report.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id),
    ["metadata-only", "anonymous-user-salt", "release", "endpoint"]
  )
})

test("Cloud and OSS endpoints share registration and stable Trace identity", async () => {
  const endpoints = [
    "https://eu.cloud.langfuse.com",
    "https://langfuse.example.internal",
  ]
  const traceIds = []

  for (const endpoint of endpoints) {
    await resetObservabilityRegistrationForTests()
    let receivedOptions
    let devtoolsCalls = 0
    const registration = await registerNodeObservability({
      source: deployedSource(endpoint),
      runtime: {
        registerTelemetry() {},
        async createDevtools() {
          devtoolsCalls += 1
          return {}
        },
        async createLangfuse(options) {
          receivedOptions = options
          return {
            integration: {},
            async forceFlush() {},
            async shutdown() {},
          }
        },
      },
    })
    assert.equal(registration.langfuse, "registered")
    assert.equal(devtoolsCalls, 0)
    assert.equal(receivedOptions.baseUrl, endpoint)
    traceIds.push(await assistantMessageTraceId("stable-message-id"))
  }

  assert.equal(traceIds[0], traceIds[1])
  await resetObservabilityRegistrationForTests()
})
