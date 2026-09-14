"use client"

import { useMemo } from "react"
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react"
import type { FlowSpec } from "@/lib/visualization/types"
import { adaptFlowSpec } from "@/lib/visualization/renderer-adapter"
import { FlowNode } from "@/components/visualization/flow-node"
import { FlowGroup } from "@/components/visualization/flow-group"
import { FlowEdge } from "@/components/visualization/flow-edge"
import { reactFlowAdapter } from "@/components/visualization/react-flow-adapter"

const nodeTypes = { flowNode: FlowNode, flowGroup: FlowGroup }
const edgeTypes = { flowEdge: FlowEdge }

function Canvas({ spec }: { spec: FlowSpec }) {
  const graph = useMemo(() => adaptFlowSpec(spec, reactFlowAdapter), [spec])
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const fit = () => void fitView({ padding: 0.2, maxZoom: 1.15, duration: 180 })
  const reset = () => void fitView({ padding: 0.2, maxZoom: 1, duration: 220 })

  return (
    <div className="relative h-[360px] min-h-[280px] w-full overflow-hidden rounded-b-xl bg-muted/20">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-sm backdrop-blur">
        <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="适应画布" aria-label="适应画布" onClick={fit}>
          <Maximize2 size={14} />
        </button>
        <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="缩小" aria-label="缩小" onClick={() => void zoomOut({ duration: 120 })}>
          <Minus size={14} />
        </button>
        <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="放大" aria-label="放大" onClick={() => void zoomIn({ duration: 120 })}>
          <Plus size={14} />
        </button>
        <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="重置" aria-label="重置" onClick={reset}>
          <RotateCcw size={14} />
        </button>
      </div>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
    </div>
  )
}

export function FlowCanvas({ spec }: { spec: FlowSpec }) {
  return (
    <ReactFlowProvider>
      <Canvas spec={spec} />
    </ReactFlowProvider>
  )
}
