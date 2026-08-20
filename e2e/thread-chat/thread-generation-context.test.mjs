import assert from "node:assert/strict"
import { prepareThreadGenerationContext } from "../../app/api/chat/thread-generation-context.ts"

const messages = [
  { id: "u0", role: "user", parts: [{ type: "text", text: "client" }] },
]
const identity = {
  treeId: "11111111-1111-4111-8111-111111111111",
  threadId: "main",
  userMessageId: "u1",
  assistantMessageId: "a1",
  generationId: "22222222-2222-4222-8222-222222222222",
  intent: { kind: "persisted-turn" },
}

function dependencies(overrides = {}) {
  return {
    threadModelAllowed: () => true,
    async prepare() {
      assert.fail("prepare should be overridden for a valid Thread request")
    },
    summarize: (generation) => generation,
    compile: () => [],
    createController: () => new AbortController(),
    register() {},
    unregister() {},
    observe: () => ({ stop() {}, done: Promise.resolve() }),
    async settleInitializationFailure() {},
    startErrorResponse: () => Response.json({ mapped: true }, { status: 409 }),
    ...overrides,
  }
}

const linear = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "minimax-m2",
    messages,
    threadChat: undefined,
  },
  dependencies()
)
assert.equal(linear.kind, "ready")
assert.equal(linear.persistence, null)
assert.equal(linear.authoritativeMessages, messages)
assert.equal(linear.generationController, null)

const invalidIdentity = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "glm-5.3",
    messages,
    threadChat: { treeId: "invalid" },
  },
  dependencies()
)
assert.equal(invalidIdentity.kind, "response")
assert.equal(invalidIdentity.response.status, 400)
assert.equal(
  (await invalidIdentity.response.json()).error.code,
  "invalid_generation_identity"
)

const invalidModel = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "minimax-m2",
    messages,
    threadChat: identity,
  },
  dependencies({ threadModelAllowed: () => false })
)
assert.equal(invalidModel.kind, "response")
assert.equal(invalidModel.response.status, 400)
assert.equal(
  (await invalidModel.response.json()).error.code,
  "invalid_thread_model"
)

const existingGeneration = { id: identity.generationId, status: "streaming" }
const duplicate = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "glm-5.3",
    messages,
    threadChat: identity,
  },
  dependencies({
    async prepare(input) {
      assert.equal(input.userId, "user-1")
      assert.equal(input.modelId, "glm-5.3")
      assert.equal(input.generationId, identity.generationId)
      return { created: false, generation: existingGeneration }
    },
    summarize(generation) {
      return { id: generation.id, status: generation.status }
    },
  })
)
assert.equal(duplicate.kind, "response")
assert.equal(duplicate.response.status, 202)
assert.deepEqual(await duplicate.response.json(), {
  generation: existingGeneration,
})

const authoritativeMessages = [
  { id: "persisted", role: "user", parts: [{ type: "text", text: "db" }] },
]
const controller = new AbortController()
const observer = { stop() {}, done: Promise.resolve() }
const registrations = []
const success = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "glm-5.3",
    messages,
    threadChat: identity,
  },
  dependencies({
    async prepare() {
      return {
        created: true,
        revision: 7,
        state: {
          threads: { main: { anchorText: "  authoritative anchor  " } },
        },
      }
    },
    compile(input) {
      assert.equal(input.threadId, "main")
      assert.equal(input.excludeAssistantMessageId, "a1")
      return authoritativeMessages
    },
    createController: () => controller,
    register(generationId, receivedController) {
      registrations.push([generationId, receivedController])
    },
    observe: () => observer,
  })
)
assert.equal(success.kind, "ready")
assert.equal(success.persistence.generationId, identity.generationId)
assert.equal(success.authoritativeMessages, authoritativeMessages)
assert.equal(success.authoritativeAnchorText, "  authoritative anchor  ")
assert.equal(success.preparedRevision, 7)
assert.equal(success.generationController, controller)
assert.equal(success.generationObserver, observer)
assert.deepEqual(registrations, [[identity.generationId, controller]])

const mappedFailure = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "glm-5.3",
    messages,
    threadChat: identity,
  },
  dependencies({
    async prepare() {
      throw new Error("conflict")
    },
  })
)
assert.equal(mappedFailure.kind, "response")
assert.equal(mappedFailure.response.status, 409)
assert.deepEqual(await mappedFailure.response.json(), { mapped: true })

const initializationSettlements = []
const initializationFailure = await prepareThreadGenerationContext(
  {
    userId: "user-1",
    modelId: "glm-5.3",
    messages,
    threadChat: identity,
    unbilledPreview: false,
  },
  dependencies({
    async prepare() {
      return {
        created: true,
        revision: 8,
        state: { threads: { main: { anchorText: null } } },
      }
    },
    compile() {
      throw new Error("compile failed after generation creation")
    },
    async settleInitializationFailure(input) {
      initializationSettlements.push(input)
    },
  })
)
assert.equal(initializationFailure.kind, "response")
assert.equal(initializationFailure.response.status, 500)
assert.equal(initializationSettlements.length, 1)
assert.equal(
  initializationSettlements[0].persistence.generationId,
  identity.generationId
)
assert.equal(initializationSettlements[0].usageUnavailable, true)

console.log(
  "PASS  thread generation context owns identity, surface, idempotency, authoritative state, cancellation, and mapped failures"
)
