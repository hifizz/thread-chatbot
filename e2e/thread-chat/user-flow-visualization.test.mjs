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
