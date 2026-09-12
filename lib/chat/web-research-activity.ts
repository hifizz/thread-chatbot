export const WEB_RESEARCH_TOOL_NAMES = ["webSearch", "readUrl"] as const
export type WebResearchToolName = (typeof WEB_RESEARCH_TOOL_NAMES)[number]

export interface WebResearchSource {
  title: string
  url: string
}

export interface WebResearchActivity {
  toolCallId: string
  kind: "search" | "read"
  status: "running" | "complete" | "failed"
  truncated?: boolean
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

/** 兼容历史未包装的结果；新失败结果永远不产生来源。 */
export function webResearchData(output: unknown): Record<string, unknown> | undefined {
  if (!isRecord(output) || output.ok === false) return undefined
  return output.ok === true ? (isRecord(output.data) ? output.data : undefined) : output
}

/** webSearch provider output 到产品来源列表的唯一规范化边界。 */
export function webResearchSourcesFromOutput(
  output: unknown
): WebResearchSource[] {
  output = webResearchData(output)
  if (!isRecord(output) || !Array.isArray(output.results)) return []
  const seen = new Set<string>()
  return output.results.flatMap((result) => {
    if (!isRecord(result) || typeof result.url !== "string") return []
    const url = result.url.trim()
    if (!url || seen.has(url)) return []
    seen.add(url)
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
      if (chunk.type === "tool-input-start") return true
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
      const output = webResearchData(chunk.output)
      onActivity({
        toolCallId,
        kind: call.toolName === "webSearch" ? "search" : "read",
        status: output ? "complete" : "failed",
        truncated: typeof output?.fullyRead === "boolean" ? !output.fullyRead : output?.truncated === true,
        query:
          call.toolName === "webSearch"
            ? (textField(output, "query") ?? textField(call.input, "query"))
            : undefined,
        url:
          call.toolName === "readUrl"
            ? (textField(output, "url") ?? textField(call.input, "url"))
            : undefined,
        sources:
          call.toolName === "webSearch"
            ? webResearchSourcesFromOutput(output)
            : [],
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
        status: "failed",
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

/** 历史或终态消息不应保留悬挂的读取状态；成功来源仍保留。 */
export function settledResearchActivities(activities: WebResearchActivity[], settled: boolean): WebResearchActivity[] {
  return settled ? activities.map((activity) => activity.status === "running"
    ? { ...activity, status: "failed", sources: [] } : activity) : activities
}
