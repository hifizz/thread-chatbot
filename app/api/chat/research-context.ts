import type { LanguageModel, UIMessage } from "ai"
import {
  createResearchPlan,
  resolveResearchRoute,
  type ResearchRoute,
} from "@/lib/chat/research-router"
import {
  latestUserText,
  recentConversationText,
} from "@/app/api/chat/conversation-text"

type ResearchContextInput = {
  model: LanguageModel
  messages: UIMessage[]
  deepResearchRequested: boolean
  searchReady: boolean
}

type ResearchContextDependencies = {
  resolveRoute: typeof resolveResearchRoute
  createPlan: typeof createResearchPlan
}

const defaultDependencies: ResearchContextDependencies = {
  resolveRoute: resolveResearchRoute,
  createPlan: createResearchPlan,
}

/** 解析一次请求的联网路由与可选研究计划，不执行实际搜索。 */
export async function resolveResearchContext(
  { model, messages, deepResearchRequested, searchReady }: ResearchContextInput,
  dependencies: ResearchContextDependencies = defaultDependencies
) {
  const latestText = latestUserText(messages)
  const researchRoute: ResearchRoute = deepResearchRequested
    ? searchReady
      ? {
          mode: "research",
          reasonCode: "multi_source_research",
          urls: [],
          suggestedQueries: [],
        }
      : {
          mode: "answer",
          reasonCode: "search_unavailable",
          urls: [],
          suggestedQueries: [],
        }
    : await dependencies.resolveRoute({
        model,
        latestUserText: latestText,
        recentConversation: recentConversationText(messages),
        searchReady,
      })
  const researchPlan =
    researchRoute.mode === "research"
      ? await dependencies.createPlan({
          model,
          userRequest: latestText,
          route: researchRoute,
        })
      : null

  return { latestText, researchRoute, researchPlan }
}
