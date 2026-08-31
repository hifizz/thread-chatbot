import { z } from "zod"

export const AGENT_CASE_SCHEMA_VERSION = "agent-case-v1" as const

const routeModeSchema = z.enum(["answer", "fetch", "search", "research"])
const terminalStateSchema = z.enum(["completed", "stopped", "failed"])
const cacheOutcomeSchema = z.enum([
  "eligible",
  "cold-start",
  "partial-warm",
  "provider-hit",
  "provider-miss",
  "usage-unavailable",
  "route-drift",
  "ttl-expired",
  "below-minimum",
])

const modelAttemptFixtureSchema = z
  .object({
    stepIndex: z.number().int().min(0),
    routeId: z.string().min(1),
    toolProfileId: z.string().min(1),
    stableRequestPrefixHash: z.string().min(1),
    cacheOutcome: cacheOutcomeSchema,
    inputTokens: z.number().min(0).optional(),
    cacheReadTokens: z.number().min(0).optional(),
    cacheWriteTokens: z.number().min(0).optional(),
    costUsd: z.number().min(0).optional(),
  })
  .strict()

const cacheFixtureSchema = z
  .object({
    eligible: z.boolean(),
    reason: z.string().min(1),
    requestPrefixHash: z.string().min(1).optional(),
    toolProfileId: z.string().min(1).optional(),
    routeId: z.string().min(1).optional(),
    inputTokens: z.number().min(0).optional(),
    cacheReadTokens: z.number().min(0).optional(),
    cacheWriteTokens: z.number().min(0).optional(),
    costUsd: z.number().min(0).optional(),
    quoteCount: z.number().int().min(0).max(50).optional(),
    metadataExcluded: z.boolean().optional(),
  })
  .strict()

export const agentCaseSchema = z
  .object({
    schemaVersion: z.literal(AGENT_CASE_SCHEMA_VERSION),
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120),
    suite: z.enum([
      "core-answer",
      "search-routing",
      "memory-context",
      "multimodal",
      "reliability",
      "prompt-cache",
    ]),
    tags: z.array(z.string().min(1).max(80)).min(1),
    sensitivity: z.enum(["synthetic", "public", "authorized-private"]),
    execution: z.enum(["fixture", "content", "lifecycle"]),
    input: z
      .object({
        messages: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant"]),
                text: z.string().max(200_000),
              })
              .strict()
          )
          .min(1),
        attachments: z
          .array(
            z
              .object({
                fixture: z.string().min(1),
                mediaType: z.string().min(1),
                filename: z.string().min(1).optional(),
              })
              .strict()
          )
          .default([]),
        lifecycleScenario: z.enum(["complete", "stop", "fail"]).optional(),
      })
      .strict(),
    expected: z
      .object({
        route: routeModeSchema.optional(),
        tools: z.array(z.string().min(1)).optional(),
        terminalState: terminalStateSchema.optional(),
        contains: z.array(z.string().min(1)).optional(),
        excludes: z.array(z.string().min(1)).optional(),
        citationsRequired: z.boolean().optional(),
        memoryFacts: z.array(z.string().min(1)).optional(),
        forbiddenFacts: z.array(z.string().min(1)).optional(),
        groundingFacts: z.array(z.string().min(1)).optional(),
        sourceDomains: z.array(z.string().min(1)).optional(),
        jsonKeys: z.array(z.string().min(1)).optional(),
        maxToolCount: z.number().int().min(0).optional(),
        fallbackExpected: z.boolean().optional(),
        errorCategory: z.string().min(1).optional(),
        cacheEligible: z.boolean().optional(),
        cacheOutcome: cacheOutcomeSchema.optional(),
        prefixHash: z.string().min(1).optional(),
        quoteCount: z.number().int().min(0).max(50).optional(),
        metadataExcluded: z.boolean().optional(),
        rubric: z.string().min(1).max(4_000).optional(),
      })
      .strict(),
    fixtureResult: z
      .object({
        text: z.string(),
        route: routeModeSchema.optional(),
        tools: z.array(z.string()).default([]),
        terminalState: terminalStateSchema.default("completed"),
        usage: z.record(z.string(), z.number()).optional(),
        providerAttempts: z
          .array(
            z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          )
          .default([]),
        /** Optional so existing cases keep byte-identical dataset revisions. */
        modelAttempts: z.array(modelAttemptFixtureSchema).optional(),
        cache: cacheFixtureSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type AgentCase = z.infer<typeof agentCaseSchema>
export type AgentSuite = AgentCase["suite"]
export type AgentCaseExecution = AgentCase["execution"]

export function parseAgentCase(value: unknown): AgentCase {
  return agentCaseSchema.parse(value)
}
