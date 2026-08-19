export const WEB_RESEARCH_TOOL_NAMES = ["webSearch", "readUrl"] as const
export type WebResearchToolName = (typeof WEB_RESEARCH_TOOL_NAMES)[number]

export interface WebResearchSource {
  title: string
  url: string
}

export interface WebResearchActivity {
  toolCallId: string
  kind: "search" | "read"
  status: "running" | "complete"
  query?: string
  url?: string
  sources: WebResearchSource[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isWebResearchToolName(value: unknown): value is WebResearchToolName {
  return (
    typeof value === "string" &&
    WEB_RESEARCH_TOOL_NAMES.some((name) => name === value)
  )
}

function textField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined
  const text = value[field]
  return typeof text === "string" && text.trim() ? text.trim() : undefined
}

function sourcesFromOutput(output: unknown): WebResearchSource[] {
  if (!isRecord(output) || !Array.isArray(output.results)) return []
  return output.results.flatMap((result) => {
    if (!isRecord(result) || typeof result.url !== "string") return []
    const url = result.url.trim()
    if (!url) return []
    const title =
      typeof result.title === "string" && result.title.trim()
        ? result.title.trim()
        : url
    return [{ title, url }]
  })
}

type TrackedCall = {
  toolName: WebResearchToolName
  input?: unknown
}

/** 把 AI SDK UI stream 的联网 tool chunks 聚合成可渲染、可持久化的活动事件。 */
export function createWebResearchActivityDispatcher(
  onActivity: (activity: WebResearchActivity) => void
): (chunk: unknown) => boolean {
  const calls = new Map<string, TrackedCall>()

  return (chunk) => {
    if (!isRecord(chunk) || typeof chunk.toolCallId !== "string") return false
    const toolCallId = chunk.toolCallId

    if (
      (chunk.type === "tool-input-start" ||
        chunk.type === "tool-input-available") &&
      isWebResearchToolName(chunk.toolName)
    ) {
      const input =
        chunk.type === "tool-input-available" ? chunk.input : undefined
      calls.set(toolCallId, { toolName: chunk.toolName, input })
      onActivity({
        toolCallId,
        kind: chunk.toolName === "webSearch" ? "search" : "read",
        status: "running",
        query:
          chunk.toolName === "webSearch"
            ? textField(input, "query")
            : undefined,
        url: chunk.toolName === "readUrl" ? textField(input, "url") : undefined,
        sources: [],
      })
      return true
    }

    const call = calls.get(toolCallId)
    if (!call) return false

    if (chunk.type === "tool-output-available") {
      const output = chunk.output
      onActivity({
        toolCallId,
        kind: call.toolName === "webSearch" ? "search" : "read",
        status: "complete",
        query:
          call.toolName === "webSearch"
            ? (textField(output, "query") ?? textField(call.input, "query"))
            : undefined,
        url:
          call.toolName === "readUrl"
            ? (textField(output, "url") ?? textField(call.input, "url"))
            : undefined,
        sources: call.toolName === "webSearch" ? sourcesFromOutput(output) : [],
      })
      return true
    }

    if (
      chunk.type === "tool-output-error" ||
      chunk.type === "tool-output-denied" ||
      chunk.type === "tool-input-error"
    ) {
      onActivity({
        toolCallId,
        kind: call.toolName === "webSearch" ? "search" : "read",
        status: "complete",
        query:
          call.toolName === "webSearch"
            ? textField(call.input, "query")
            : undefined,
        url:
          call.toolName === "readUrl"
            ? textField(call.input, "url")
            : undefined,
        sources: [],
      })
      return true
    }

    return false
  }
}
