import { z } from "zod"

export const AGENT_CASE_SCHEMA_VERSION = "agent-case-v1" as const

const routeModeSchema = z.enum(["answer", "fetch", "search", "research"])
const terminalStateSchema = z.enum(["completed", "stopped", "failed"])

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
