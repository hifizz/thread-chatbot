import dagre from "@dagrejs/dagre"
import { Position, type Edge, type Node } from "@xyflow/react"
import type {
  FlowDirection,
  FlowEdge,
  FlowNode,
  FlowSpec,
} from "@/lib/visualization/types"
import type { FlowRendererAdapter } from "@/lib/visualization/renderer-adapter"

const NODE_WIDTH = 196
const NODE_HEIGHT = 76

export type FlowRenderNodeData = Record<string, unknown> & {
  semanticNode: FlowNode
  direction: FlowDirection
}

export type FlowRenderEdgeData = Record<string, unknown> & {
  semanticEdge: FlowEdge
}

export type FlowRenderNode = Node<FlowRenderNodeData, "flowNode">
export type FlowRenderEdge = Edge<FlowRenderEdgeData, "flowEdge">

export interface ReactFlowGraph {
  nodes: FlowRenderNode[]
  edges: FlowRenderEdge[]
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
    const nodes: FlowRenderNode[] = spec.nodes.map((node) => {
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
    }))

    return { nodes, edges }
  },
}
