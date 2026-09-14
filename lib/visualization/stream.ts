import { GENERATE_VISUALIZATION_TOOL_NAME } from "@/lib/visualization/tool"
import { generateVisualizationResultSchema } from "@/lib/visualization/schema"
import type { VisualizationData } from "@/lib/visualization/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Derive the authoritative data-visualization part only from a verified tool result. */
export function createVisualizationDispatcher(
  onVisualization: (input: {
    toolCallId: string
    visualization: VisualizationData
  }) => void
): (chunk: unknown) => boolean {
  const calls = new Set<string>()

  return (chunk) => {
    if (!isRecord(chunk) || typeof chunk.toolCallId !== "string") return false
    const toolCallId = chunk.toolCallId

    if (
      (chunk.type === "tool-input-start" ||
        chunk.type === "tool-input-available") &&
      chunk.toolName === GENERATE_VISUALIZATION_TOOL_NAME
    ) {
      calls.add(toolCallId)
      return true
    }

    if (!calls.has(toolCallId)) return false

    if (chunk.type === "tool-output-available") {
      const parsed = generateVisualizationResultSchema.safeParse(chunk.output)
      calls.delete(toolCallId)
      if (!parsed.success) return true
      onVisualization({
        toolCallId,
        visualization: parsed.data.visualization,
      })
      return true
    }

    if (
      chunk.type === "tool-output-error" ||
      chunk.type === "tool-output-denied" ||
      chunk.type === "tool-input-error"
    ) {
      calls.delete(toolCallId)
      return true
    }

    return false
  }
}
