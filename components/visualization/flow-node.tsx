"use client"

import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { FlowRenderNode } from "@/components/visualization/react-flow-adapter"

const kindLabels = {
  start: "开始",
  end: "结束",
  action: "操作",
  decision: "判断",
  screen: "界面",
  system: "系统",
} as const

export function FlowNode({ data }: NodeProps<FlowRenderNode>) {
  const node = data.semanticNode
  const horizontal = data.direction === "LR"

  return (
    <div className="w-[196px] rounded-xl border border-border bg-card px-3 py-2.5 text-card-foreground shadow-sm">
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border-background !bg-muted-foreground"
      />
      <div className="flex items-center gap-2">
        {node.kind ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {kindLabels[node.kind]}
          </span>
        ) : null}
        <span className="min-w-0 text-sm font-medium leading-5">{node.label}</span>
      </div>
      {node.description ? (
        <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
          {node.description}
        </p>
      ) : null}
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className="!h-2 !w-2 !border-background !bg-muted-foreground"
      />
    </div>
  )
}
