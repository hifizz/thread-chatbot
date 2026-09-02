import { z } from "zod"

export const AGENT_CASE_SCHEMA_VERSION = "agent-case-v1" as const

const routeModeSchema = z.enum(["answer", "fetch", "search", "research"])
const terminalStateSchema = z.enum(["completed", "stopped", "failed"])

const attachmentFixtureSchema = z
  .object({
    fixture: z.string().min(1),
    mediaType: z.string().min(1),
    filename: z.string().min(1).optional(),
  })
  .strict()

const projectContextSchema = z
  .object({
    target: z.string().max(4_000).nullable().default(null),
    instructions: z.string().max(20_000).nullable().default(null),
    files: z.array(attachmentFixtureSchema).default([]),
    /** 同一 eval user 的另一个 Project；用于验证 Project File 不跨 Project 泄漏。 */
    foreignFiles: z.array(attachmentFixtureSchema).default([]),
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
        attachments: z.array(attachmentFixtureSchema).default([]),
        projectContext: projectContextSchema.optional(),
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
