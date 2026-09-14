import type { FlowSpec } from "@/lib/visualization/types"
import { flowSpecSchema } from "@/lib/visualization/schema"

export type FlowVerificationErrorCode =
  | "schema_invalid"
  | "duplicate_node_id"
  | "duplicate_edge_id"
  | "unknown_edge_source"
  | "unknown_edge_target"
  | "duplicate_edge"
  | "self_loop"
  | "duplicate_group_id"
  | "unknown_group_node"
  | "duplicate_group_node"

export interface FlowVerificationError {
  code: FlowVerificationErrorCode
  path: string
  message: string
}

export interface FlowVerificationResult {
  valid: boolean
  errors: FlowVerificationError[]
}

function duplicateValues(values: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return duplicates
}

export function verifyFlowGraph(spec: FlowSpec): FlowVerificationResult {
  const errors: FlowVerificationError[] = []
  const nodeIds = new Set(spec.nodes.map((node) => node.id))

  for (const id of duplicateValues(spec.nodes.map((node) => node.id))) {
    errors.push({
      code: "duplicate_node_id",
      path: "nodes",
      message: `Duplicate node id: ${id}`,
    })
  }

  for (const id of duplicateValues(spec.edges.map((edge) => edge.id))) {
    errors.push({
      code: "duplicate_edge_id",
      path: "edges",
      message: `Duplicate edge id: ${id}`,
    })
  }

  const edgeKeys = new Set<string>()
  spec.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        code: "unknown_edge_source",
        path: `edges.${index}.from`,
        message: `Unknown edge source: ${edge.from}`,
      })
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        code: "unknown_edge_target",
        path: `edges.${index}.to`,
        message: `Unknown edge target: ${edge.to}`,
      })
    }
    if (edge.from === edge.to) {
      errors.push({
        code: "self_loop",
        path: `edges.${index}`,
        message: `Self loop is not allowed: ${edge.from}`,
      })
    }
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ""}`
    if (edgeKeys.has(key)) {
      errors.push({
        code: "duplicate_edge",
        path: `edges.${index}`,
        message: `Duplicate edge: ${edge.from} -> ${edge.to}`,
      })
    }
    edgeKeys.add(key)
  })

  const groups = spec.groups ?? []
  for (const id of duplicateValues(groups.map((group) => group.id))) {
    errors.push({
      code: "duplicate_group_id",
      path: "groups",
      message: `Duplicate group id: ${id}`,
    })
  }

  groups.forEach((group, groupIndex) => {
    const groupNodeIds = new Set<string>()
    group.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) {
        errors.push({
          code: "unknown_group_node",
          path: `groups.${groupIndex}.nodeIds.${nodeIndex}`,
          message: `Unknown group node: ${nodeId}`,
        })
      }
      if (groupNodeIds.has(nodeId)) {
        errors.push({
          code: "duplicate_group_node",
          path: `groups.${groupIndex}.nodeIds.${nodeIndex}`,
          message: `Duplicate group node: ${nodeId}`,
        })
      }
      groupNodeIds.add(nodeId)
    })
  })

  return { valid: errors.length === 0, errors }
}

export function verifyFlowSpec(value: unknown): FlowVerificationResult {
  const parsed = flowSpecSchema.safeParse(value)
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "schema_invalid" as const,
        path: issue.path.join("."),
        message: issue.message,
      })),
    }
  }
  return verifyFlowGraph(parsed.data)
}
