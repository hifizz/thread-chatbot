import type { ResearchRouteMode } from "@/lib/chat/research-contract"

export type ResearchToolName = "readUrl" | "webSearch"

const RESEARCH_TOOL_NAMES_BY_MODE = {
  answer: [],
  fetch: ["readUrl"],
  search: ["webSearch", "readUrl"],
  research: ["webSearch", "readUrl"],
} as const satisfies Record<ResearchRouteMode, readonly ResearchToolName[]>

/** 路由模式可暴露的联网能力；数组顺序同时定义首步强制工具。 */
export function researchToolNames(
  mode: ResearchRouteMode
): readonly ResearchToolName[] {
  return RESEARCH_TOOL_NAMES_BY_MODE[mode]
}
