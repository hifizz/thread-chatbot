"use client"

import type { NodeProps } from "@xyflow/react"
import type { FlowGroupRenderNode } from "@/components/visualization/react-flow-adapter"

export function FlowGroup({ data }: NodeProps<FlowGroupRenderNode>) {
  return (
    <div className="pointer-events-none h-full w-full rounded-2xl border border-dashed border-border bg-muted/10 px-3 pt-2 text-[11px] font-medium text-muted-foreground">
      <div className="truncate" title={data.semanticGroup.label}>{data.semanticGroup.label}</div>
    </div>
  )
}
