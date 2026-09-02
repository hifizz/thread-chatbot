import {
  generateText,
  NoObjectGeneratedError,
  Output,
  type LanguageModel,
} from "ai"
import {
  RESEARCH_PLANNER_MAX_OUTPUT_TOKENS,
  RESEARCH_PLANNER_SYSTEM_PROMPT,
  RESEARCH_ROUTER_MAX_OUTPUT_TOKENS,
  RESEARCH_ROUTER_SYSTEM_PROMPT,
} from "@/constants/research"
import type { ChatModel } from "@/constants/model"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import {
  withModelCallLogging,
  type ModelCallTrace,
} from "@/lib/ai/model-call-logger"
import {
  researchPlanSchema,
  researchRouteSchema,
  type ResearchPlan,
  type ResearchRoute,
  type ResearchRouteMode,
} from "@/lib/chat/research-contract"
import { throwIfGenerationCancelled } from "@/lib/ai/generation-cancellation"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"

export {
  researchPlanSchema,
  researchRouteModeSchema,
  researchRouteSchema,
  type ResearchPlan,
  type ResearchRoute,
  type ResearchRouteMode,
} from "@/lib/chat/research-contract"

export interface ResolveResearchRouteInput {
  model: LanguageModel
  latestUserText: string
  recentConversation: string
  searchReady: boolean
  modelCallTrace?: ModelCallTrace
  abortSignal?: AbortSignal
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/** 部分兼容端点忽略结构化输出协议，改为返回 fenced JSON；只从失败响应恢复 JSON。 */
function jsonObjectFromFailedStructuredOutput(error: unknown): unknown {
  if (!NoObjectGeneratedError.isInstance(error)) return null
  const text = error.text?.trim()
  if (!text) return null
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function strings(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : fallback
}

/** 兼容 UMAPIS 上游常见的 researchGoal/subQuestions/searchQueries 别名。 */
function normalizePlannerCandidate(value: unknown): unknown {
  if (!isRecord(value)) return value
  const rawQuestions = value.subquestions ?? value.subQuestions
  const subquestions = Array.isArray(rawQuestions)
    ? rawQuestions.slice(0, 8).flatMap((raw, index) => {
        if (!isRecord(raw)) return []
        const question = raw.question
        if (typeof question !== "string" || !question.trim()) return []
        const queries = strings(raw.queries ?? raw.searchQueries)
          .filter((query) => query.trim())
          .slice(0, 4)
        return [
          {
            id:
              typeof raw.id === "string" && raw.id.trim()
                ? raw.id.slice(0, 40)
                : `q${index + 1}`,
            question: question.slice(0, 300),
            queries: queries.length > 0 ? queries : [question.slice(0, 200)],
            preferredSourceTypes: strings(raw.preferredSourceTypes, [
              "official",
              "primary-source",
            ]).slice(0, 4),
            requiresPageFetch: raw.requiresPageFetch === true,
          },
        ]
      })
    : []
  const rawExit = isRecord(value.exitCriteria)
    ? value.exitCriteria
    : isRecord(value.exitConditions)
      ? value.exitConditions
      : {}
  const rawMinimum =
    rawExit.minimumIndependentSources ?? rawExit.minOfficialSources

  return {
    goal:
      typeof value.goal === "string"
        ? value.goal
        : typeof value.researchGoal === "string"
          ? value.researchGoal
          : "",
    subquestions,
    exitCriteria: {
      minimumIndependentSources:
        typeof rawMinimum === "number"
          ? Math.max(1, Math.min(12, Math.round(rawMinimum)))
          : 3,
      requirePrimarySources:
        typeof rawExit.requirePrimarySources === "boolean"
          ? rawExit.requirePrimarySources
          : typeof rawExit.minOfficialSources === "number"
            ? rawExit.minOfficialSources > 0
            : true,
      freshnessRequired:
        typeof rawExit.freshnessRequired === "boolean"
          ? rawExit.freshnessRequired
          : false,
    },
  }
}

const URL_PATTERN = /https?:\/\/[^\s<>{}\[\]"'，。！？、；：]+/gi

function trimUrlPunctuation(url: string): string {
  return url.replace(/[)\]}>，。！？、；：,.!?;:]+$/g, "")
}

export function extractHttpUrls(text: string): string[] {
  return [...new Set((text.match(URL_PATTERN) ?? []).map(trimUrlPunctuation))]
}

function explicitlyDisablesWeb(text: string): boolean {
  return /(?:不要|无需|不用|禁止).{0,8}(?:联网|搜索|检索|访问网络)|\b(?:do\s+not|don'?t|without)\s+(?:browse|search|use\s+the\s+web)\b/i.test(
    text
  )
}

/** “总结这个链接”等跟进从最近对话恢复 URL；普通总结仍保持本地回答。 */
export function contextualUrlFollowUpRoute(
  latestUserText: string,
  recentConversation: string
): ResearchRoute | null {
  if (explicitlyDisablesWeb(latestUserText)) return null
  if (extractHttpUrls(latestUserText).length > 0) return null
  const refersToPage =
    /(?:总结|翻译|分析|解读|概括|改写).{0,16}(?:(?:这个|这篇|该|上面|之前)(?:链接|网页|页面|网址)|(?:链接|网页|页面|网址)(?:内容)?)|\b(?:summari[sz]e|translate|analy[sz]e|explain)\b.{0,24}\b(?:(?:this|that|the|previous)\s+)?(?:link|url|page)\b/i.test(
      latestUserText
    )
  if (!refersToPage) return null
  const urls = extractHttpUrls(recentConversation).slice(-4)
  return urls.length > 0 ? route("fetch", "explicit_url", { urls }) : null
}

function route(
  mode: ResearchRouteMode,
  reasonCode: ResearchRoute["reasonCode"],
  options?: Partial<Pick<ResearchRoute, "urls" | "suggestedQueries">>
): ResearchRoute {
  return {
    mode,
    reasonCode,
    urls: options?.urls ?? [],
    suggestedQueries: options?.suggestedQueries ?? [],
  }
}

/** 高置信快速路由；返回 null 表示需要模型做结构化分类。 */
export function deterministicResearchRoute(text: string): ResearchRoute | null {
  const normalized = text.trim()
  if (!normalized) return route("answer", "no_web_needed")

  if (explicitlyDisablesWeb(normalized)) return route("answer", "no_web_needed")

  const urls = extractHttpUrls(normalized)
  const complexResearch =
    /(?:充分|深入|深度|全面|系统性?).{0,8}(?:调研|研究|调查)|(?:多来源|多角度|交叉核验|一手资料|业界做法|行业实践|竞品调研)|\b(?:deep\s+(?:research|dive)|multi-source|cross-check|industry\s+research)\b/i.test(
      normalized
    )
  if (complexResearch)
    return route("research", "multi_source_research", { urls })

  if (urls.length > 0) return route("fetch", "explicit_url", { urls })

  const explicitSearch =
    /(?:联网|上网|网络).{0,8}(?:搜索|检索|查找|查询|看看)|(?:搜索|检索|查找|搜一下|查一下).{0,12}(?:网页|网站|网络|互联网|资料|来源|文档|github|社区)|\b(?:web\s+search|search\s+the\s+web|browse\s+the\s+web|look\s+up)\b/i.test(
      normalized
    )
  if (explicitSearch) return route("search", "explicit_search")

  const freshnessRequired =
    /(?:最新|当前|现在|今天|今日|本周|本月|实时|刚刚|近期).{0,20}(?:价格|版本|动态|新闻|政策|法规|职位|负责人|发布|更新|状态|数据|汇率|天气)|(?:价格|版本|动态|新闻|政策|法规|职位|负责人|状态|汇率|天气).{0,12}(?:最新|当前|现在|今天|实时|近期)|\b(?:latest|current|today|real-time|recent)\b/i.test(
      normalized
    )
  if (freshnessRequired) return route("search", "freshness_required")

  const obviousAnswer =
    /^(?:请|帮我|请你)?\s*(?:解释|说明|改写|润色|翻译|总结|概括|续写|起草|写|计算|推导|分析这段|检查这段|优化这段)|(?:什么是|是什么意思|为什么|如何理解|怎么理解)|\b(?:explain|rewrite|polish|translate|summarize|draft|calculate|derive|what\s+is|why\s+does)\b/i.test(
      normalized
    )
  if (obviousAnswer) return route("answer", "no_web_needed")

  return null
}

function normalizeModelRoute(
  value: ResearchRoute,
  searchReady: boolean
): ResearchRoute {
  if (!searchReady && value.mode !== "answer") {
    return route("answer", "search_unavailable")
  }
  if (value.mode === "fetch" && value.urls.length === 0) {
    return { ...value, mode: "search", reasonCode: "explicit_search" }
  }
  return value
}

/** 确定性规则优先；模糊问题才用当前所选模型做低推理强度分类。 */
export async function resolveResearchRoute({
  model,
  latestUserText,
  recentConversation,
  searchReady,
  modelCallTrace,
  abortSignal,
}: ResolveResearchRouteInput): Promise<ResearchRoute> {
  throwIfGenerationCancelled(abortSignal)
  const contextualFollowUp = contextualUrlFollowUpRoute(
    latestUserText,
    recentConversation
  )
  if (contextualFollowUp)
    return normalizeModelRoute(contextualFollowUp, searchReady)
  const deterministic = deterministicResearchRoute(latestUserText)
  if (deterministic) return normalizeModelRoute(deterministic, searchReady)
  if (!searchReady) return route("answer", "search_unavailable")

  try {
    const result = await generateText({
      ...buildAiTelemetryConfig(
        MODEL_CALL_PURPOSE.researchRoute,
        modelCallTrace
      ),
      model: withModelCallLogging(
        model,
        MODEL_CALL_PURPOSE.researchRoute,
        modelCallTrace
      ),
      reasoning: "low",
      system: RESEARCH_ROUTER_SYSTEM_PROMPT,
      prompt: [
        "只输出符合下列字段的原始 JSON，不要使用 Markdown 代码块：",
        '{"mode":"answer|fetch|search|research","reasonCode":"no_web_needed|explicit_url|explicit_search|freshness_required|multi_source_research|search_unavailable","urls":[],"suggestedQueries":[]}',
        "",
        "最近对话（仅供理解指代）：",
        recentConversation,
        "",
        "最后一条用户请求：",
        latestUserText,
      ].join("\n"),
      output: Output.object({ schema: researchRouteSchema }),
      maxOutputTokens: RESEARCH_ROUTER_MAX_OUTPUT_TOKENS,
      abortSignal,
    })
    throwIfGenerationCancelled(abortSignal)
    return normalizeModelRoute(result.output, searchReady)
  } catch (error) {
    throwIfGenerationCancelled(abortSignal)
    const recovered = researchRouteSchema.safeParse(
      jsonObjectFromFailedStructuredOutput(error)
    )
    if (recovered.success)
      return normalizeModelRoute(recovered.data, searchReady)
    console.warn(
      `[research-router] 模型路由失败，降级为直接回答: ${errorSummary(error)}`
    )
    return route("answer", "no_web_needed")
  }
}

export async function createResearchPlan({
  model,
  userRequest,
  route: resolvedRoute,
  modelCallTrace,
  abortSignal,
}: {
  model: LanguageModel
  userRequest: string
  route: ResearchRoute
  modelCallTrace?: ModelCallTrace
  abortSignal?: AbortSignal
}): Promise<ResearchPlan> {
  throwIfGenerationCancelled(abortSignal)
  try {
    const result = await generateText({
      ...buildAiTelemetryConfig(
        MODEL_CALL_PURPOSE.researchPlan,
        modelCallTrace
      ),
      model: withModelCallLogging(
        model,
        MODEL_CALL_PURPOSE.researchPlan,
        modelCallTrace
      ),
      reasoning: "high",
      system: RESEARCH_PLANNER_SYSTEM_PROMPT,
      prompt: [
        "只输出符合下列字段的原始 JSON，不要使用 Markdown 代码块，也不要改写字段名：",
        '{"goal":"...","subquestions":[{"id":"q1","question":"...","queries":["..."],"preferredSourceTypes":["official"],"requiresPageFetch":true}],"exitCriteria":{"minimumIndependentSources":3,"requirePrimarySources":true,"freshnessRequired":false}}',
        "",
        "用户研究目标：",
        userRequest,
        "",
        "路由器建议查询：",
        resolvedRoute.suggestedQueries.join("\n") || "无",
        "",
        "用户提供的 URL：",
        resolvedRoute.urls.join("\n") || "无",
      ].join("\n"),
      output: Output.object({ schema: researchPlanSchema }),
      maxOutputTokens: RESEARCH_PLANNER_MAX_OUTPUT_TOKENS,
      abortSignal,
    })
    throwIfGenerationCancelled(abortSignal)
    return result.output
  } catch (error) {
    throwIfGenerationCancelled(abortSignal)
    const recovered = researchPlanSchema.safeParse(
      normalizePlannerCandidate(jsonObjectFromFailedStructuredOutput(error))
    )
    if (recovered.success) return recovered.data
    console.warn(
      `[research-planner] 结构化计划失败，使用单目标计划: ${errorSummary(error)}`
    )
    return {
      goal: userRequest.slice(0, 300),
      subquestions: [
        {
          id: "q1",
          question: userRequest.slice(0, 300),
          queries:
            resolvedRoute.suggestedQueries.length > 0
              ? resolvedRoute.suggestedQueries.slice(0, 4)
              : [userRequest.slice(0, 200)],
          preferredSourceTypes: ["official", "primary-source"],
          requiresPageFetch: true,
        },
      ],
      exitCriteria: {
        minimumIndependentSources: 3,
        requirePrimarySources: true,
        freshnessRequired: resolvedRoute.reasonCode === "freshness_required",
      },
    }
  }
}

export function reasoningForResearchRoute(
  mode: ResearchRouteMode,
  model?: Pick<ChatModel, "provider" | "umapisCredentialGroup">
): "provider-default" | "none" | "medium" | "high" {
  // UMAPIS 的 Anthropic 兼容端点可能不返回可供下一工具步骤回放的 signed
  // reasoning metadata；多步联网时显式关闭，避免丢弃历史 reasoning 并逐步告警。
  if (
    model?.provider === "umapis" &&
    model.umapisCredentialGroup === "claude" &&
    mode !== "answer"
  )
    return "none"
  if (mode === "research") return "high"
  if (mode === "search" || mode === "fetch") return "medium"
  return "provider-default"
}

export function researchPlanExecutionPrompt(plan: ResearchPlan): string {
  return [
    "你正在执行一份已批准的结构化研究计划。按子问题检索并在必要时深读原文；不要向用户复述内部推理。",
    `研究目标：${plan.goal}`,
    ...plan.subquestions.map(
      (item) =>
        `${item.id}. ${item.question}\n建议查询：${item.queries.join("；")}`
    ),
    `完成条件：至少 ${plan.exitCriteria.minimumIndependentSources} 个独立来源；${plan.exitCriteria.requirePrimarySources ? "必须包含一手来源" : "不强制一手来源"}。`,
  ].join("\n")
}
