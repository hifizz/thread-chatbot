import { z } from "zod"

/** 联网路由和研究计划跨模型、SSE 与持久化边界共享的唯一运行时契约。 */
export const researchRouteModeSchema = z.enum([
  "answer",
  "fetch",
  "search",
  "research",
])
export type ResearchRouteMode = z.infer<typeof researchRouteModeSchema>

export const researchRouteSchema = z.object({
  mode: researchRouteModeSchema,
  reasonCode: z.enum([
    "no_web_needed",
    "explicit_url",
    "explicit_search",
    "freshness_required",
    "multi_source_research",
    "search_unavailable",
  ]),
  urls: z.array(z.string()).max(4),
  suggestedQueries: z.array(z.string().trim().min(1)).max(4),
})
export type ResearchRoute = z.infer<typeof researchRouteSchema>

export const researchPlanSchema = z.object({
  goal: z.string().trim().min(1).max(300),
  subquestions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        question: z.string().trim().min(1).max(300),
        queries: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
        preferredSourceTypes: z
          .array(z.string().trim().min(1).max(80))
          .max(4),
        requiresPageFetch: z.boolean(),
      })
    )
    .min(1)
    .max(8),
  exitCriteria: z.object({
    minimumIndependentSources: z.number().int().min(1).max(12),
    requirePrimarySources: z.boolean(),
    freshnessRequired: z.boolean(),
  }),
})
export type ResearchPlan = z.infer<typeof researchPlanSchema>
