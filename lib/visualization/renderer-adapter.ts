import type { FlowSpec } from "@/lib/visualization/types"

/** Renderer libraries consume FlowSpec only through this replaceable boundary. */
export interface FlowRendererAdapter<TGraph> {
  toGraph(spec: FlowSpec): TGraph
}

export function adaptFlowSpec<TGraph>(
  spec: FlowSpec,
  adapter: FlowRendererAdapter<TGraph>
): TGraph {
  return adapter.toGraph(spec)
}
