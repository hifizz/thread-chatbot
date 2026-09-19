import assert from "node:assert/strict"
import { flowSpecSchema, generateVisualizationResultSchema } from "../../lib/visualization/schema.ts"
import { verifyFlowGraph } from "../../lib/visualization/verify-flow.ts"
import { adaptFlowSpec } from "../../lib/visualization/renderer-adapter.ts"
import { createVisualizationDispatcher } from "../../lib/visualization/stream.ts"
import { assistantPartRenderPlan } from "../../app/thread-chat/branching/assistant/assistant-part-render-plan.ts"

const valid = {
  version: 1,
  direction: "LR",
  nodes: [
    { id: "start", label: "开始", kind: "start" },
    { id: "decide", label: "是否深入？", kind: "decision" },
    { id: "fork", label: "Fork", kind: "action" },
  ],
  edges: [
    { id: "e1", from: "start", to: "decide" },
    { id: "e2", from: "decide", to: "fork", label: "是" },
  ],
  groups: [{ id: "main", label: "主流程", nodeIds: ["start", "decide", "fork"] }],
}

assert.equal(flowSpecSchema.safeParse(valid).success, true)
assert.equal(
  flowSpecSchema.safeParse({
    ...valid,
    nodes: [{ ...valid.nodes[0], position: { x: 1, y: 2 } }, ...valid.nodes.slice(1)],
  }).success,
  false,
  "renderer fields must be rejected by the persisted FlowSpec schema"
)
assert.equal(verifyFlowGraph(valid).valid, true)

const invalid = {
  ...valid,
  nodes: [valid.nodes[0], valid.nodes[0]],
  edges: [
    { id: "dup", from: "start", to: "missing" },
    { id: "dup", from: "start", to: "start" },
    { id: "e3", from: "start", to: "missing" },
  ],
  groups: [{ id: "g", label: "G", nodeIds: ["missing", "missing"] }],
}
const codes = new Set(verifyFlowGraph(invalid).errors.map((error) => error.code))
for (const code of [
  "duplicate_node_id",
  "duplicate_edge_id",
  "unknown_edge_target",
  "self_loop",
  "duplicate_edge",
  "unknown_group_node",
  "duplicate_group_node",
]) {
  assert.equal(codes.has(code), true, `expected verification error ${code}`)
}

const snapshot = structuredClone(valid)
const first = adaptFlowSpec(valid, {
  toGraph: (spec) => ({ ids: spec.nodes.map((node) => node.id) }),
})
const second = adaptFlowSpec(valid, {
  toGraph: (spec) => ({ labels: spec.nodes.map((node) => node.label), renderer: "mock-v2" }),
})
assert.deepEqual(first.ids, ["start", "decide", "fork"])
assert.equal(second.renderer, "mock-v2")
assert.deepEqual(valid, snapshot, "renderer adapters must not mutate the semantic IR")

const toolResult = {
  visualization: { kind: "user-flow", spec: valid },
  verification: { schema: "passed", graph: "passed", semantic: "skipped" },
  generation: {
    modelId: "private-relay-gpt-5.6-luna",
    attempts: 1,
    repairs: 0,
    firstPass: "passed",
    durationMs: 12,
  },
}
assert.equal(generateVisualizationResultSchema.safeParse(toolResult).success, true)
const derived = []
const dispatch = createVisualizationDispatcher((value) => derived.push(value))
dispatch({ type: "tool-input-available", toolCallId: "viz-1", toolName: "generate_visualization", input: { kind: "user-flow", prompt: "x" } })
dispatch({ type: "tool-output-available", toolCallId: "viz-1", output: toolResult })
assert.equal(derived.length, 1)
assert.deepEqual(derived[0].visualization.spec, valid)

dispatch({ type: "tool-input-available", toolCallId: "viz-2", toolName: "generate_visualization", input: { kind: "user-flow", prompt: "x" } })
dispatch({ type: "tool-output-available", toolCallId: "viz-2", output: { visualization: { kind: "user-flow", spec: { bad: true } } } })
assert.equal(derived.length, 1, "invalid tool output must not create a persisted visualization part")

const plan = assistantPartRenderPlan({
  id: "assistant-viz",
  parentMessageId: "user-viz",
  role: "assistant",
  text: "",
  forks: [],
  status: "done",
  uiParts: [
    { type: "tool-generate_visualization", toolCallId: "viz-1", state: "output-available", input: { kind: "user-flow", prompt: "x" }, output: toolResult },
    { type: "data-visualization", id: "visualization:viz-1", data: toolResult.visualization },
  ],
})
assert.deepEqual(plan.map((item) => item.kind), ["visualization"])

console.log("PASS  user-flow visualization keeps semantic IR renderer-independent and persists only verified data")

// Exercise the actual SDK/provider boundary without paid requests.
const { generateVerifiedVisualization } = await import('../../lib/visualization/generate-flow.ts')
const { visualizationForModel } = await import('../../lib/visualization/model-context.ts')
const { convertToModelMessages } = await import('ai')
const savedFetch = globalThis.fetch
const savedEnv = { ...process.env }
const requests = []
let candidates = []
try {
  process.env.TOKEN_ROUTER_BASE_URL = 'https://visualization.example.test/v1'
  process.env.TOKEN_ROUTER_API_KEY = 'test-key'
  delete process.env.VISUALIZATION_MODEL_ID
  delete process.env.AXIOM_TOKEN
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return Response.json({
      id: 'test', object: 'chat.completion', created: 1, model: 'gpt-5.6-luna',
      choices: [{ index: 0, message: { role: 'assistant', content: candidates.shift() }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 10, total_tokens: 18 },
    })
  }
  const rendererLeak = { ...valid, position: { x: 100, y: 200 } }
  candidates = [JSON.stringify(rendererLeak), JSON.stringify(valid)]
  const repaired = await generateVerifiedVisualization({ kind: 'user-flow', prompt: '画流程' })
  assert.equal(repaired.generation.attempts, 2)
  assert.equal(repaired.generation.firstPass, 'failed')
  assert.match(JSON.stringify(requests[1].messages), /schema_invalid/)
  assert.match(JSON.stringify(requests[1].messages), /position/)
  assert(requests.every((request) => request.model === 'gpt-5.6-luna'))

  requests.length = 0
  candidates = Array(3).fill(JSON.stringify(invalid))
  await assert.rejects(generateVerifiedVisualization({ kind: 'user-flow', prompt: '画流程' }), /VISUALIZATION_GENERATION_FAILED/)
  assert.equal(requests.length, 3, 'initial generation plus at most two repairs')
  assert.match(JSON.stringify(requests[1].messages), /unknown_edge_target/)

  requests.length = 0
  candidates = ['{broken', JSON.stringify(valid)]
  await generateVerifiedVisualization({ kind: 'user-flow', prompt: '画流程' })
  assert.match(JSON.stringify(requests[1].messages), /Output is not valid JSON/)

  process.env.VISUALIZATION_MODEL_ID = 'iceland-gemini-3.7-flash'
  candidates = [JSON.stringify(valid)]
  const switched = await generateVerifiedVisualization({ kind: 'user-flow', prompt: '画流程' })
  assert.equal(switched.generation.modelId, 'iceland-gemini-3.7-flash')
  assert.deepEqual(switched.visualization, toolResult.visualization)
} finally {
  globalThis.fetch = savedFetch
  process.env = savedEnv
}
const stored = JSON.parse(JSON.stringify({ id: 'history', role: 'assistant', parts: [
  { type: 'data-visualization', data: toolResult.visualization },
] }))
const context = await convertToModelMessages([stored], {
  convertDataPart: (part) => part.type === 'data-visualization' ? visualizationForModel(part.data) : undefined,
})
assert.match(JSON.stringify(context), /是否深入/)
assert.equal(visualizationForModel({ kind: 'user-flow', spec: invalid }), undefined)
console.log('PASS  bounded schema/graph repair, model override, and historical visualization context')

const { reactFlowAdapter } = await import('../../components/visualization/react-flow-adapter.ts')
const collisionSpec = { ...valid, nodes: [...valid.nodes, { id: 'group:main', label: '合法业务 ID' }] }
const beforeAdapter = structuredClone(collisionSpec)
const concrete = reactFlowAdapter.toGraph(collisionSpec)
assert.equal(new Set(concrete.nodes.map((node) => node.id)).size, concrete.nodes.length)
assert(concrete.edges.every((edge) => edge.markerEnd && concrete.nodes.some((node) => node.id === edge.source)))
assert.deepEqual(collisionSpec, beforeAdapter)
console.log('PASS  concrete adapter preserves IR, avoids group ID collisions, and marks edge direction')

for (const field of ['x', 'y', 'position', 'sourceHandle', 'targetHandle', 'style', 'className', 'reactFlowNodeType', 'dagreRank', 'elkOptions']) {
  assert.equal(flowSpecSchema.safeParse({ ...valid, nodes: [{ ...valid.nodes[0], [field]: 'forbidden' }] }).success, false)
}
for (const bad of [
  { ...valid, version: 2 }, { ...valid, direction: 'RL' },
  { ...valid, nodes: Array(51).fill(valid.nodes[0]) },
  { ...valid, edges: Array(101).fill(valid.edges[0]) },
  { ...valid, groups: [{ ...valid.groups[0], position: {} }] },
  { ...valid, edges: [{ ...valid.edges[0], sourceHandle: 'x' }] },
]) assert.equal(flowSpecSchema.safeParse(bad).success, false)
assert(verifyFlowGraph({ ...valid, edges: [{ id: 'bad', from: 'missing', to: 'start' }] }).errors.some(e => e.code === 'unknown_edge_source'))
assert(verifyFlowGraph({ ...valid, groups: [valid.groups[0], valid.groups[0]] }).errors.some(e => e.code === 'duplicate_group_id'))

const { consumeUIMessagePipeline } = await import('../../lib/thread-chat/streaming/ui-message-pipeline.ts')
const initialMessage = { id: 'persist-viz', role: 'assistant', parts: [] }
let persisted
await consumeUIMessagePipeline({
  initialMessage,
  session: { publish: (_chunk, snapshot) => { persisted = snapshot }, replaceSnapshot: snapshot => { persisted = snapshot } },
  textStream: new ReadableStream({ start(controller) {
    for (const chunk of [
      { type: 'start' }, { type: 'start-step', request: {}, warnings: [] },
      { type: 'tool-call', toolCallId: 'persist-tool', toolName: 'generate_visualization', input: { kind: 'user-flow', prompt: 'test' } },
      { type: 'tool-result', toolCallId: 'persist-tool', toolName: 'generate_visualization', input: { kind: 'user-flow', prompt: 'test' }, output: toolResult },
      { type: 'finish-step', response: {}, usage: {}, performance: {}, finishReason: 'stop' },
      { type: 'finish', finishReason: 'stop', totalUsage: {} },
    ]) controller.enqueue(chunk)
    controller.close()
  } }),
})
assert(!persisted.parts.some(p => p.type === 'tool-generate_visualization'))
assert.deepEqual(JSON.parse(JSON.stringify(persisted)).parts.find(p => p.type === 'data-visualization').data, toolResult.visualization)
console.log('PASS  actual UIMessage reducer retains authoritative visualization and removes internal tool payload')
