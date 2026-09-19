export const GENERATE_VISUALIZATION_TOOL_NAME = "generate_visualization" as const

export type FlowDirection = "LR" | "TB"

export type FlowNodeKind =
  | "start"
  | "end"
  | "action"
  | "decision"
  | "screen"
  | "system"

export interface FlowNode {
  id: string
  label: string
  description?: string
  kind?: FlowNodeKind
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  label?: string
}

export interface FlowGroup {
  id: string
  label: string
  nodeIds: string[]
}

/**
 * ThreadChat-owned semantic IR. Renderer/layout-specific fields MUST NOT be
 * added here; they belong behind FlowRendererAdapter.
 */
export interface FlowSpec {
  version: 1
  direction: FlowDirection
  nodes: FlowNode[]
  edges: FlowEdge[]
  groups?: FlowGroup[]
}

export interface UserFlowVisualization {
  kind: "user-flow"
  spec: FlowSpec
}

export type VisualizationData = UserFlowVisualization

export interface GenerateVisualizationInput {
  kind: "user-flow"
  prompt: string
  direction?: FlowDirection
}

export interface VisualizationVerificationMetadata {
  schema: "passed"
  graph: "passed"
  semantic: "skipped"
}

export interface VisualizationGenerationMetadata {
  modelId: string
  attempts: number
  repairs: number
  firstPass: "passed" | "failed"
  durationMs: number
}

export interface GenerateVisualizationResult {
  visualization: UserFlowVisualization
  verification: VisualizationVerificationMetadata
  generation: VisualizationGenerationMetadata
}
