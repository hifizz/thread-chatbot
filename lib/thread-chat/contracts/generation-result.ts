import { z } from "zod"
import { GENERATION_RESULT_VERSION } from "@/constants/generation"
import {
  researchPlanSchema,
  researchRouteSchema,
} from "@/lib/chat/research-contract"

const artifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["code", "note", "markdown"]),
  lang: z.string().optional(),
  content: z.string(),
  sourceThreadId: z.string(),
  sourceMessageId: z.string(),
})

const webResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
})

const webResearchActivitySchema = z.object({
  toolCallId: z.string(),
  kind: z.enum(["search", "read"]),
  status: z.enum(["running", "complete"]),
  query: z.string().optional(),
  url: z.string().optional(),
  sources: z.array(webResearchSourceSchema),
})

const generationUsageMetadataSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number().optional(),
})

/** generation result V1 的唯一运行时与 TypeScript 契约。 */
export const generationResultV1Schema = z.object({
  version: z.literal(GENERATION_RESULT_VERSION),
  generationId: z.string(),
  text: z.string(),
  status: z.enum(["pending", "streaming", "done", "error"]),
  error: z.string().optional(),
  artifactIds: z.array(z.string()),
  artifacts: z.record(z.string(), artifactSchema),
  webResearch: z.array(webResearchActivitySchema).optional(),
  webResearchTextOffset: z.number().optional(),
  researchRoute: researchRouteSchema.optional(),
  researchPlan: researchPlanSchema.optional(),
  usage: generationUsageMetadataSchema.optional(),
})

export type GenerationResultV1 = z.infer<typeof generationResultV1Schema>
