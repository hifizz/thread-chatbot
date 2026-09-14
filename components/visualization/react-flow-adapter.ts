import dagre from "@dagrejs/dagre"
import { Position, type Edge, type Node } from "@xyflow/react"
import type {
  FlowDirection,
  FlowEdge,
  FlowGroup,
  FlowNode,
  FlowSpec,
} from "@/lib/visualization/types"
import type { FlowRendererAdapter } from "@/lib/visualization/renderer-adapter"

const NODE_WIDTH = 196
const NODE_HEIGHT = 76
const GROUP_PADDING_X = 24
const GROUP_PADDING_TOP = 38
const GROUP_PADDING_BOTTOM = 18

export type FlowRenderNodeData = Record<string, unknown> & {
  semanticNode: FlowNode
  direction: FlowDirection
}

export type FlowGroupRenderNodeData = Record<string, unknown> & {
  semanticGroup: FlowGroup
}

export type FlowRenderEdgeData = Record<string, unknown> & {
  semanticEdge: FlowEdge
}

export type FlowRenderNode = Node<FlowRenderNodeData, "flowNode">
export type FlowGroupRenderNode = Node<FlowGroupRenderNodeData, "flowGroup">
export type FlowRenderEdge = Edge<FlowRenderEdgeData, "flowEdge">

export interface ReactFlowGraph {
  nodes: Array<FlowRenderNode | FlowGroupRenderNode>
  edges: FlowRenderEdge[]
}

function groupNodes(
  spec: FlowSpec,
  semanticNodes: FlowRenderNode[]
): FlowGroupRenderNode[] {
  const byId = new Map(semanticNodes.map((node) => [node.id, node]))
  return (spec.groups ?? []).flatMap((group) => {
    const members = group.nodeIds.flatMap((id) => {
      const node = byId.get(id)
      return node ? [node] : []
    })
    if (members.length === 0) return []

    const minX = Math.min(...members.map((node) => node.position.x))
    const minY = Math.min(...members.map((node) => node.position.y))
    const maxX = Math.max(...members.map((node) => node.position.x + NODE_WIDTH))
    const maxY = Math.max(...members.map((node) => node.position.y + NODE_HEIGHT))
    const width = maxX - minX + GROUP_PADDING_X * 2
    const height = maxY - minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM

    return [
      {
        id: `group:${group.id}`,
        type: "flowGroup" as const,
        position: {
          x: minX - GROUP_PADDING_X,
          y: minY - GROUP_PADDING_TOP,
        },
        width,
        height,
        style: { width, height },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: 0,
        data: { semanticGroup: group },
      },
    ]
  })
}

export const reactFlowAdapter: FlowRendererAdapter<ReactFlowGraph> = {
  toGraph(spec: FlowSpec): ReactFlowGraph {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    graph.setGraph({
      rankdir: spec.direction,
      ranksep: 64,
      nodesep: 36,
      marginx: 24,
      marginy: 24,
    })

    for (const node of spec.nodes) {
      graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
    }
    for (const edge of spec.edges) graph.setEdge(edge.from, edge.to)
    dagre.layout(graph)

    const horizontal = spec.direction === "LR"
    const semanticNodes: FlowRenderNode[] = spec.nodes.map((node) => {
      const layout = graph.node(node.id)
      return {
        id: node.id,
        type: "flowNode",
        position: {
          x: layout.x - NODE_WIDTH / 2,
          y: layout.y - NODE_HEIGHT / 2,
        },
        sourcePosition: horizontal ? Position.Right : Position.Bottom,
        targetPosition: horizontal ? Position.Left : Position.Top,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        selectable: true,
        zIndex: 2,
        data: { semanticNode: node, direction: spec.direction },
      }
    })

    const edges: FlowRenderEdge[] = spec.edges.map((edge) => ({
      id: edge.id,
      type: "flowEdge",
      source: edge.from,
      target: edge.to,
      data: { semanticEdge: edge },
      label: edge.label,
      zIndex: 1,
    }))

    return {
      nodes: [...groupNodes(spec, semanticNodes), ...semanticNodes],
      edges,
    }
  },
}
