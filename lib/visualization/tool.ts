import { tool } from "ai"
import { generateVisualizationInputSchema } from "@/lib/visualization/schema"
import { generateVerifiedVisualization } from "@/lib/visualization/generate-flow"

export const GENERATE_VISUALIZATION_TOOL_NAME = "generate_visualization" as const

export const GENERATE_VISUALIZATION_TOOL_DESCRIPTION =
  "Generate a verified user/product/business/agent flow diagram when a visual flow will materially improve understanding. Pass only the natural-language flow request and optional LR/TB direction. Do not author nodes, edges, coordinates, SVG, HTML, React Flow, Dagre, ELK, or other renderer schemas yourself."

export function createGenerateVisualizationTool() {
  return tool({
    description: GENERATE_VISUALIZATION_TOOL_DESCRIPTION,
    inputSchema: generateVisualizationInputSchema,
    execute: async (input) => generateVerifiedVisualization(input),
  })
}
