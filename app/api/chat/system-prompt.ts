import {
  DIRECT_FETCH_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  WEB_ACCESS_SYSTEM_PROMPT,
} from "@/constants/research"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import {
  researchPlanExecutionPrompt,
  type ResearchPlan,
  type ResearchRoute,
} from "@/lib/chat/research-router"

type ChatSystemPromptInput = {
  threadChat: boolean
  anchorText: string | null
  markdownArtifactRequested: boolean
  researchMode: ResearchRoute["mode"]
  researchPlan: ResearchPlan | null
  deepResearchRequested: boolean
  searchReady: boolean
}

const SEARCH_UNAVAILABLE_PROMPT =
  "用户开启了深度研究，但服务端未启用搜索服务，请如实告知该功能暂不可用，并基于已有知识尽力回答。"

/** 将各能力拥有的 system 片段按既有优先顺序组合为单一服务端提示。 */
export function buildChatSystemPrompt({
  threadChat,
  anchorText,
  markdownArtifactRequested,
  researchMode,
  researchPlan,
  deepResearchRequested,
  searchReady,
}: ChatSystemPromptInput): string {
  return [
    threadChat
      ? buildThreadChatSystem(anchorText, {
          enableMarkdownArtifact: markdownArtifactRequested,
        })
      : null,
    researchMode === "fetch" ? DIRECT_FETCH_SYSTEM_PROMPT : null,
    researchMode === "search" || researchMode === "research"
      ? WEB_ACCESS_SYSTEM_PROMPT
      : null,
    researchMode === "research" ? RESEARCH_SYSTEM_PROMPT : null,
    researchPlan ? researchPlanExecutionPrompt(researchPlan) : null,
    deepResearchRequested && !searchReady ? SEARCH_UNAVAILABLE_PROMPT : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n")
}
