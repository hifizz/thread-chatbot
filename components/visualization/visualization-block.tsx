"use client"

import { useState } from "react"
import type { VisualizationData } from "@/lib/visualization/types"
import { FlowCanvas } from "@/components/visualization/flow-canvas"

export function VisualizationBlock({
  visualization,
}: {
  visualization: VisualizationData
}) {
  const [view, setView] = useState<"preview" | "source">("preview")

  return (
    <section className="my-3 overflow-hidden rounded-xl border border-border bg-card" data-visualization-kind={visualization.kind}>
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-xs ${view === "preview" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/70"}`}
            onClick={() => setView("preview")}
          >
            图表
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-xs ${view === "source" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/70"}`}
            onClick={() => setView("source")}
          >
            源码
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">用户流程</span>
      </div>
      {view === "preview" ? (
        <FlowCanvas spec={visualization.spec} />
      ) : (
        <pre className="max-h-[360px] overflow-auto bg-muted/20 p-4 text-xs leading-5 text-foreground">
          <code>{JSON.stringify(visualization.spec, null, 2)}</code>
        </pre>
      )}
    </section>
  )
}
