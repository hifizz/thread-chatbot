import assert from "node:assert/strict"
import {
  assistantMessageTraceId,
  feedbackScoreId,
  pseudonymizeUserId,
  requestTraceId,
} from "../../lib/observability/identity.ts"
import {
  resolveObservabilityConfig,
  resolveTelemetryContentPolicy,
} from "../../lib/observability/config.ts"
import {
  maskLangfuseExport,
  maskTelemetryValue,
} from "../../lib/observability/mask.ts"
import {
  registerNodeObservability,
  resetObservabilityRegistrationForTests,
} from "../../lib/observability/register-node.ts"
import {
  buildAiTelemetryConfig,
  buildObservabilityRuntimeContext,
} from "../../lib/observability/ai-sdk.ts"

const assistantId = "assistant-123"
assert.equal(
  await assistantMessageTraceId(assistantId),
  await assistantMessageTraceId(assistantId),
  "同一 assistant Message 必须派生同一 Trace ID"
)
assert.notEqual(
  await assistantMessageTraceId(assistantId),
  await requestTraceId(assistantId),
  "不同身份域不得碰撞"
)
assert.equal(
  await feedbackScoreId(assistantId),
  await feedbackScoreId(assistantId),
  "feedback Score ID 必须可幂等重放"
)
const pseudonym = pseudonymizeUserId("user@example.com", "unit-test-salt")
assert.equal(
  pseudonym,
  pseudonymizeUserId("user@example.com", "unit-test-salt")
)
assert.notEqual(
  pseudonym,
  pseudonymizeUserId("other@example.com", "unit-test-salt")
)
assert.ok(!pseudonym.includes("user@example.com"))
assert.match(pseudonym, /^usr_[a-f0-9]{64}$/)

const productionSource = {
  NODE_ENV: "production",
  AI_TELEMETRY_ENABLED: "true",
  AI_DEVTOOLS_ENABLED: "true",
  AI_TELEMETRY_RECORD_CONTENT: "true",
  AI_OBSERVABILITY_ENVIRONMENT: "production",
}
assert.deepEqual(resolveTelemetryContentPolicy({ source: productionSource }), {
  enabled: true,
  recordInputs: false,
  recordOutputs: false,
  reason: "metadata-only",
})
assert.equal(
  resolveTelemetryContentPolicy({
    source: productionSource,
    allowContentCapture: true,
  }).reason,
  "production-cohort"
)
assert.equal(
  resolveTelemetryContentPolicy({
    source: {
      NODE_ENV: "production",
      AI_TELEMETRY_ENABLED: "true",
      AI_TELEMETRY_RECORD_CONTENT: "true",
      AI_OBSERVABILITY_ENVIRONMENT: "evaluation",
    },
  }).reason,
  "evaluation"
)
assert.equal(
  resolveObservabilityConfig(productionSource).devtoolsEnabled,
  false,
  "production 必须强制禁用 DevTools"
)
const allowedContext = buildObservabilityRuntimeContext({
  requestId: "request-1",
  modelId: "provider/model",
  allowContentCapture: true,
  // JS 合同测试故意注入未知字段，证明 allowlist 会丢弃它。
  secret: "must-not-export",
})
assert.equal(allowedContext.requestId, "request-1")
assert.equal(allowedContext.modelId, "provider/model")
assert.ok(!("secret" in allowedContext))
assert.ok(!("allowContentCapture" in allowedContext))
const telemetryConfig = buildAiTelemetryConfig("chat-answer", {
  requestId: "request-1",
})
assert.equal(telemetryConfig.telemetry.functionId, "chat-answer")
assert.equal(telemetryConfig.telemetry.recordInputs, true)
assert.deepEqual(telemetryConfig.telemetry.includeRuntimeContext, {
  requestId: true,
  environment: true,
  release: true,
})

const secretFixture = {
  authorization: "Bearer super-secret-token",
  Cookie: "session=abc",
  apiKey: "sk-abcdefghijklmnop",
  profile: {
    email: "person@example.com",
    phone: "+65 8123 4567",
    url: "https://example.com/private?a=1#secret",
  },
  query: "customer confidential query",
  attachmentBody: "private attachment body",
  pageText: "private page body",
  providerError: { body: "raw provider response" },
  output: "safe answer <think>hidden reasoning</think> after",
  nested: ["Bearer another-token", "https://example.com/path?token=secret"],
}
const masked = maskLangfuseExport({ data: secretFixture })
const serializedMasked = JSON.stringify(masked)
for (const secret of [
  "super-secret-token",
  "session=abc",
  "abcdefghijklmnop",
  "person@example.com",
  "8123 4567",
  "?a=1",
  "customer confidential query",
  "private attachment body",
  "private page body",
  "raw provider response",
  "hidden reasoning",
  "another-token",
  "?token=secret",
]) {
  assert.ok(!serializedMasked.includes(secret), `exporter 泄漏了 ${secret}`)
}
assert.equal(masked.profile.url, "https://example.com/private")
assert.equal(maskTelemetryValue({ self: null }).self, null)

function fakeRuntime({ remoteFailure = false } = {}) {
  const calls = {
    register: 0,
    devtools: 0,
    langfuse: 0,
    shutdown: 0,
  }
  return {
    calls,
    runtime: {
      registerTelemetry: (...integrations) => {
        calls.register += 1
        assert.ok(integrations.length > 0)
      },
      createDevtools: async () => {
        calls.devtools += 1
        return {}
      },
      createLangfuse: async () => {
        calls.langfuse += 1
        if (remoteFailure) throw new Error("simulated remote failure")
        return {
          integration: {},
          forceFlush: async () => {},
          shutdown: async () => {
            calls.shutdown += 1
          },
        }
      },
    },
  }
}

await resetObservabilityRegistrationForTests()
const development = fakeRuntime()
const developmentSource = {
  NODE_ENV: "development",
  AI_TELEMETRY_ENABLED: "true",
  AI_DEVTOOLS_ENABLED: "true",
  AI_OBSERVABILITY_ENVIRONMENT: "development",
}
const firstRegistration = registerNodeObservability({
  source: developmentSource,
  runtime: development.runtime,
})
const duplicateRegistration = registerNodeObservability({
  source: developmentSource,
  runtime: development.runtime,
})
assert.deepEqual(await firstRegistration, {
  status: "registered",
  devtools: "registered",
  langfuse: "unconfigured",
})
assert.deepEqual(await duplicateRegistration, await firstRegistration)
assert.deepEqual(development.calls, {
  register: 1,
  devtools: 1,
  langfuse: 0,
  shutdown: 0,
})

await resetObservabilityRegistrationForTests()
const testRuntime = fakeRuntime()
assert.equal(
  (
    await registerNodeObservability({
      source: { NODE_ENV: "test" },
      runtime: testRuntime.runtime,
    })
  ).status,
  "disabled"
)
assert.equal(testRuntime.calls.register, 0)

await resetObservabilityRegistrationForTests()
const production = fakeRuntime()
const productionResult = await registerNodeObservability({
  source: {
    ...productionSource,
    LANGFUSE_PUBLIC_KEY: "public",
    LANGFUSE_SECRET_KEY: "secret",
  },
  runtime: production.runtime,
})
assert.deepEqual(productionResult, {
  status: "registered",
  devtools: "disabled",
  langfuse: "registered",
})
assert.equal(production.calls.devtools, 0)
assert.equal(production.calls.langfuse, 1)

await resetObservabilityRegistrationForTests()
const missingCredentials = fakeRuntime()
assert.equal(
  (
    await registerNodeObservability({
      source: productionSource,
      runtime: missingCredentials.runtime,
    })
  ).langfuse,
  "unconfigured"
)
assert.equal(missingCredentials.calls.register, 0)

await resetObservabilityRegistrationForTests()
const failingRemote = fakeRuntime({ remoteFailure: true })
const originalWarn = console.warn
console.warn = () => {}
try {
  assert.deepEqual(
    await registerNodeObservability({
      source: {
        ...productionSource,
        LANGFUSE_PUBLIC_KEY: "public",
        LANGFUSE_SECRET_KEY: "secret",
      },
      runtime: failingRemote.runtime,
    }),
    { status: "degraded", devtools: "disabled", langfuse: "failed" }
  )
} finally {
  console.warn = originalWarn
}

await resetObservabilityRegistrationForTests()
console.info("observability foundation contracts passed")
