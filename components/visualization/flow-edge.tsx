"use client"

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react"
import type { FlowRenderEdge } from "@/components/visualization/react-flow-adapter"

export function FlowEdge(props: EdgeProps<FlowRenderEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 10,
  })
  const label = props.data?.semanticEdge.label

  return (
    <>
      <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute max-w-[160px] rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            <span className="line-clamp-2 break-words">{label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
