import { tool } from "ai"
import { z } from "zod"
import {
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
  type MarkdownArtifactToolResult,
} from "@/lib/chat/markdown-artifact"

const getWeather = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({
    location: z.string().describe("City name, e.g. 'San Francisco'"),
  }),
  execute: async ({ location }) => {
    const conditions = [
      "Sunny",
      "Partly Cloudy",
      "Cloudy",
      "Light Rain",
      "Clear",
    ]
    const seed = [...location].reduce((acc, c) => acc + c.charCodeAt(0), 0)
    return {
      location,
      temperatureF: 55 + (seed % 35),
      condition: conditions[seed % conditions.length],
      humidity: 30 + (seed % 50),
      asOf: new Date().toISOString(),
    }
  },
})

const compareTable = tool({
  description:
    "Render a comparison table for two or more items across one or more numeric metrics. Use whenever the user asks to compare things 'in a table' with real numeric data.",
  inputSchema: z.object({
    title: z.string(),
    unit: z.string().optional(),
    columns: z
      .array(z.string())
      .describe("Category labels, e.g. country names"),
    series: z.array(
      z.object({
        name: z.string(),
        values: z
          .array(z.number())
          .describe("One value per column, same order as columns"),
      })
    ),
  }),
  execute: async (input) => input,
})

const createMarkdownArtifact = tool({
  description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  inputSchema: markdownArtifactInputSchema,
  execute: async (): Promise<MarkdownArtifactToolResult> => ({ created: true }),
})

/** 产品 surface 对应的基础工具；联网与前端工具由 route 在其上继续组合。 */
export function surfaceTools(input: {
  threadChat: boolean
  markdownArtifactRequested: boolean
}) {
  if (!input.threadChat) return { getWeather, compareTable }
  return input.markdownArtifactRequested
    ? { [MARKDOWN_ARTIFACT_TOOL_NAME]: createMarkdownArtifact }
    : {}
}
