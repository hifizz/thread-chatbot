import assert from "node:assert/strict"
import {
  OBSERVATION_NAMES,
  TRACE_NAMES,
} from "../../constants/observability.ts"
import { assistantMessageTraceId } from "../../lib/observability/identity.ts"
import {
  observeAppOperation,
  runAgentTrace,
  setAgentTraceBackendForTests,
} from "../../lib/observability/trace.ts"
import { SessionStore } from "../../lib/thread-chat/streaming/session-store.ts"
import { initialAssistantSnapshot } from "../../lib/thread-chat/streaming/stream-session.ts"
import { generateText } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { buildAiTelemetryConfig } from "../../lib/observability/ai-sdk.ts"

function memoryBackend() {
  const nodes = []
  const events = []
  const stack = []
  let nextId = 0

  function execute(node, fn) {
    stack.push(node)
    const observation = {
      id: node.id,
      traceId: node.traceId,
      update(attributes) {
        node.updates.push(structuredClone(attributes))
        events.push({ type: "update", name: node.name })
      },
      end() {
        node.ended = true
        events.push({ type: "end", name: node.name })
      },
    }
    try {
      const result = fn(observation)
      if (result instanceof Promise) {
        return result.finally(() => {
          assert.equal(stack.pop(), node)
        })
      }
      assert.equal(stack.pop(), node)
      return result
    } catch (error) {
      assert.equal(stack.pop(), node)
      throw error
    }
  }

  return {
    nodes,
    events,
    backend: {
      runRoot(input, fn) {
        const node = {
          id: `root-${++nextId}`,
          traceId: input.traceId,
          name: input.name,
          parentId: null,
          input: structuredClone(input),
          updates: [],
          ended: false,
        }
        nodes.push(node)
        events.push({ type: "start", name: node.name })
        return execute(node, fn)
      },
      observe(name, attributes, fn) {
        const parent = stack.at(-1)
        const node = {
          id: `observation-${++nextId}`,
          traceId: parent?.traceId ?? "missing-parent",
          name,
          parentId: parent?.id ?? null,
          input: structuredClone(attributes),
          updates: [],
          ended: false,
        }
        nodes.push(node)
        events.push({ type: "start", name })
        return execute(node, fn)
      },
    },
  }
}

const messageId = "assistant-trace-contract"
const traceId = await assistantMessageTraceId(messageId)
assert.equal(traceId, await assistantMessageTraceId(messageId))
assert.notEqual(traceId, await assistantMessageTraceId(`${messageId}-retry`))

const memory = memoryBackend()
setAgentTraceBackendForTests(memory.backend)
const store = new SessionStore({ startCleanupTimer: false })
const initial = initialAssistantSnapshot({
  messageId,
  threadId: "thread-1",
  modelId: "provider/model",
})
let releaseBackground
const backgroundGate = new Promise((resolve) => {
  releaseBackground = resolve
})

const started = store.start({
  messageId,
  initialSnapshot: initial,
  run: (session) =>
    runAgentTrace(
      {
        name: TRACE_NAMES.threadChatGeneration,
        traceId,
        sessionId: "project-1",
        tags: ["contract"],
        context: {
          projectId: "project-1",
          threadId: "thread-1",
          assistantMessageId: messageId,
          modelId: "provider/model",
          pseudonymousUserId: "usr_opaque",
          environment: "test",
          release: "contract",
        },
      },
      async (root) => {
        await observeAppOperation(
          OBSERVATION_NAMES.researchRoute,
          { metadata: { purpose: "research-route" } },
          async (observation) => {
            observation.update({ output: { mode: "search" } })
          }
        )
        await observeAppOperation(
          OBSERVATION_NAMES.researchPlan,
          { metadata: { purpose: "research-plan" } },
          async (observation) => {
            observation.update({ output: { subquestionCount: 2 } })
          }
        )
        await observeAppOperation(
          OBSERVATION_NAMES.chatAnswer,
          { metadata: { purpose: "chat-answer" } },
          async () => {
            await observeAppOperation(
              "ai.streamText.step",
              { metadata: { step: 1 } },
              async () => {
                await observeAppOperation(
                  "tool.webSearch",
                  { metadata: { tool: "webSearch" } },
                  async () => {}
                )
              }
            )
          }
        )

        await backgroundGate
        await observeAppOperation(
          OBSERVATION_NAMES.persistenceCheckpoint,
          { metadata: { successfulWrites: 1, finalSerializedBytes: 64 } },
          async () => {}
        )
        await observeAppOperation(
          OBSERVATION_NAMES.generationFinalize,
          { metadata: { requestedStatus: "completed" } },
          async () => {}
        )
        const terminal = {
          id: messageId,
          projectId: "project-1",
          threadId: "thread-1",
          sequence: 2,
          role: "assistant",
          parts: [{ type: "text", text: "done", state: "done" }],
          status: "completed",
          modelId: "provider/model",
          replacesMessageId: null,
          supersededAt: null,
          feedback: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        }
        session.finish(terminal, {
          ...initial,
          parts: terminal.parts,
        })
        root.update({
          output: { status: "completed", finishReason: "stop" },
          metadata: {
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
          },
        })
      }
    ),
})

const received = []
const disconnect = store.subscribe(messageId, (event) => received.push(event))
disconnect()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(
  memory.nodes.find((node) => node.name === TRACE_NAMES.threadChatGeneration)
    .ended,
  false,
  "SSE 订阅者离开时后台根 Trace 不能提前结束"
)
releaseBackground()
await started.session.task

const root = memory.nodes.find(
  (node) => node.name === TRACE_NAMES.threadChatGeneration
)
assert.equal(root.traceId, traceId)
assert.equal(root.input.sessionId, "project-1")
assert.equal(root.input.context.pseudonymousUserId, "usr_opaque")
assert.ok(root.ended)
assert.equal(store.get(messageId).terminalMessage.status, "completed")
assert.equal(received.length, 1, "断开后不再向旧 subscriber 广播终态")

const expectedNames = [
  TRACE_NAMES.threadChatGeneration,
  OBSERVATION_NAMES.researchRoute,
  OBSERVATION_NAMES.researchPlan,
  OBSERVATION_NAMES.chatAnswer,
  "ai.streamText.step",
  "tool.webSearch",
  OBSERVATION_NAMES.persistenceCheckpoint,
  OBSERVATION_NAMES.generationFinalize,
]
assert.deepEqual(
  memory.nodes.map((node) => node.name),
  expectedNames
)
for (const node of memory.nodes.slice(1)) {
  assert.equal(node.traceId, traceId)
  assert.ok(node.parentId, `${node.name} 必须有父 Observation`)
}
assert.ok(
  root.updates.some(
    (update) =>
      update.output?.status === "completed" &&
      update.metadata?.totalTokens === 20
  )
)

await assert.rejects(
  () =>
    observeAppOperation(
      "controlled.failure",
      { metadata: { purpose: "failure-contract" } },
      async () => {
        const error = new Error("private provider payload")
        error.code = "ETIMEDOUT"
        throw error
      }
    ),
  /private provider payload/
)
const failed = memory.nodes.find((node) => node.name === "controlled.failure")
assert.ok(
  failed.updates.some(
    (update) =>
      update.level === "ERROR" &&
      update.metadata?.errorCategory === "timeout" &&
      update.metadata?.purpose === "failure-contract" &&
      update.metadata?.operationOutcome === "error" &&
      !JSON.stringify(update).includes("private provider payload")
  )
)

const aiEvents = []
const telemetryIntegration = Object.fromEntries(
  [
    "onStart",
    "onStepStart",
    "onLanguageModelCallStart",
    "onLanguageModelCallEnd",
    "onStepEnd",
    "onEnd",
  ].map((name) => [name, (event) => aiEvents.push({ name, event })])
)
const aiConfig = buildAiTelemetryConfig("chat-answer", {
  requestId: "request-ai-sdk",
  projectId: "project-1",
  threadId: "thread-1",
  assistantMessageId: messageId,
  modelId: "mock/model",
  environment: "test",
})
const generated = await generateText({
  model: new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock/model",
    doGenerate: {
      content: [{ type: "text", text: "safe mock answer" }],
      finishReason: "stop",
      usage: {
        inputTokens: {
          total: 3,
          noCache: 3,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 4, text: 4, reasoning: 0 },
      },
      warnings: [],
    },
  }),
  prompt: "safe fixture",
  runtimeContext: aiConfig.runtimeContext,
  telemetry: {
    ...aiConfig.telemetry,
    isEnabled: true,
    integrations: telemetryIntegration,
  },
  maxRetries: 0,
})
assert.equal(generated.text, "safe mock answer")
assert.deepEqual(
  aiEvents.map(({ name }) => name),
  [
    "onStart",
    "onStepStart",
    "onLanguageModelCallStart",
    "onLanguageModelCallEnd",
    "onStepEnd",
    "onEnd",
  ]
)
assert.ok(
  aiEvents.every(({ event }) => event.functionId === "chat-answer"),
  "AI SDK operation/step/model lifecycle 必须共享稳定 functionId"
)
assert.equal(aiEvents[0].event.runtimeContext.projectId, "project-1")
assert.equal(aiEvents[0].event.runtimeContext.assistantMessageId, messageId)

setAgentTraceBackendForTests(null)
store.dispose()
console.info("agent trace lifecycle contracts passed")
