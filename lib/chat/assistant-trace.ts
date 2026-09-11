import type { ResearchPlan } from "./research-contract"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { webResearchSourcesFromOutput, type WebResearchSource } from "./web-research-activity"

export type TracePhase = "running" | "complete" | "error" | "stopped" | "incomplete"
export interface TraceTool {
  id: string
  name: string
  input: string
  phase: TracePhase
  sources: WebResearchSource[]
}

/** 未完成的调用不能因生成结束而变成成功；刷新后同样依据持久 part 和消息终态。 */
export function unfinishedTracePhase(status: string | undefined): TracePhase {
  if (status === "pending" || status === "streaming") return "running"
  if (status === "stopped") return "stopped"
  if (status === "error") return "error"
  return "incomplete"
}

function field(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) return ""
  const text = (value as Record<string, unknown>)[key]
  return typeof text === "string" ? text : ""
}

export function traceToolFromPart(part: ThreadChatUIMessage["parts"][number], status: string | undefined): TraceTool | null {
  if (part.type === "data-research-activity") {
    const activity = part.data
    return {
      id: activity.toolCallId,
      name: activity.kind === "search" ? "webSearch" : "readUrl",
      input: activity.query ?? activity.url ?? "",
      phase: activity.status === "complete" ? "complete" : activity.status === "error" ? "error"
        : activity.status === "cancelled" ? "stopped" : unfinishedTracePhase(status),
      sources: activity.sources,
    }
  }
  if (!("toolCallId" in part) || !("state" in part)) return null
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
  return {
    id: part.toolCallId,
    name,
    input: field(part.input, name === "webSearch" ? "query" : "url"),
    phase: part.state === "output-available" ? "complete"
      : part.state === "output-error" || part.state === "output-denied" ? "error" : unfinishedTracePhase(status),
    sources: part.state === "output-available" && name === "webSearch" ? webResearchSourcesFromOutput(part.output) : [],
  }
}

export function traceSourceHref(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/** 只引用现有计划原文；不截取思考正文、不猜测语义，也不为标题调用模型。 */
export function researchQuestionForTrace(
  plan: ResearchPlan | undefined,
  parts: ThreadChatUIMessage["parts"]
): string | undefined {
  if (!plan) return undefined
  const questions = new Set<string>()
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ")
  const calls = parts.filter((part) => "toolCallId" in part || part.type === "data-research-activity")
  const running = calls.filter((part) => part.type === "data-research-activity"
    ? part.data.status === "running"
    : "state" in part && part.state !== "output-available" && part.state !== "output-error" && part.state !== "output-denied")
  const currentCalls = running.length > 0 ? running : calls.slice(-1)
  for (const part of currentCalls) {
    const input = "input" in part ? part.input : part.type === "data-research-activity" ? part.data : null
    const id = field(input, "subquestionId")
    const query = field(input, "query")
    const matches = id ? plan.subquestions.filter((question) => question.id === id)
      : query ? plan.subquestions.filter((question) => question.queries.some((candidate) => normalize(candidate) === normalize(query))) : []
    if (matches.length !== 1) {
      // 已开始的工具无法确认所属问题时，不沿用上一条问题误导用户。
      if ("toolCallId" in part || part.type === "data-research-activity") return undefined
      continue
    }
    questions.add(matches[0].question)
  }
  return questions.size === 1 ? [...questions][0] : undefined
}

/** 标题只关联这段思考紧接着发起的工具；后续问题不能改写前面思考的标题。 */
export function researchQuestionForReasoning(
  plan: ResearchPlan | undefined,
  parts: ThreadChatUIMessage["parts"],
  position: number
): string | undefined {
  const questions = new Set<string>()
  for (const part of parts.slice(position + 1)) {
    if (part.type === "reasoning" || part.type === "text") break
    if (!("toolCallId" in part) && part.type !== "data-research-activity") continue
    const question = researchQuestionForTrace(plan, [part])
    if (!question) return undefined
    questions.add(question)
  }
  return questions.size === 1 ? [...questions][0] : undefined
}
