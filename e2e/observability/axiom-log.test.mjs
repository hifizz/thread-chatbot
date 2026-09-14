import assert from "node:assert/strict"
import { axiomConfigured, logger } from "../../lib/axiom/server.ts"

const originalFetch = globalThis.fetch
const originalInfo = console.info
const originalEnv = {
  AXIOM_TOKEN: process.env.AXIOM_TOKEN,
  AXIOM_DATASET: process.env.AXIOM_DATASET,
  AXIOM_EDGE_URL: process.env.AXIOM_EDGE_URL,
  AI_OBSERVABILITY_ENVIRONMENT: process.env.AI_OBSERVABILITY_ENVIRONMENT,
  AI_OBSERVABILITY_RELEASE: process.env.AI_OBSERVABILITY_RELEASE,
}

try {
  process.env.AXIOM_TOKEN = "test-token"
  process.env.AXIOM_DATASET = "thread-chat-test"
  process.env.AXIOM_EDGE_URL = "https://eu-central-1.aws.edge.axiom.co/"
  process.env.AI_OBSERVABILITY_ENVIRONMENT = "test"
  process.env.AI_OBSERVABILITY_RELEASE = "sha-test"

  const requests = []
  const stdout = []
  console.info = (line) => stdout.push(String(line))
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(JSON.stringify({ ingested: 1, failed: 0 }), { status: 200 })
  }

  assert.equal(axiomConfigured(), true)
  logger.info("tool.failure", {
    event: "tool.failure",
    requestId: "req-1",
    traceId: "trace-1",
  })
  await logger.flush()

  assert.equal(requests.length, 1)
  assert.equal(
    requests[0].url,
    "https://eu-central-1.aws.edge.axiom.co/v1/ingest/thread-chat-test"
  )
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-token")
  const body = JSON.parse(requests[0].init.body)
  assert.equal(body.length, 1)
  assert.equal(body[0].message, "tool.failure")
  assert.equal(body[0].level, "info")
  assert.equal(body[0].source, "server-log")
  assert.equal(body[0].fields.event, "tool.failure")
  assert.equal(body[0].fields.requestId, "req-1")
  assert.equal(body[0].fields.traceId, "trace-1")
  assert.equal(body[0].environment, "test")
  assert.equal(body[0].release, "sha-test")
  assert.equal(body[0].service, "thread-chat")
  assert.ok(body[0]._time)
  assert.ok(!requests[0].init.body.includes("test-token"))
  assert.equal(stdout.length, 1)

  delete process.env.AXIOM_EDGE_URL
  assert.equal(axiomConfigured(), false)
  logger.info("local.only")
  await logger.flush()
  assert.equal(requests.length, 1)

  originalInfo("Axiom logger：结构化 stdout、批量 ingest、元数据与安全降级通过")
} finally {
  globalThis.fetch = originalFetch
  console.info = originalInfo
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
