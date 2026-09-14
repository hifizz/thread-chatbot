import { z } from "zod"

export const flowDirectionSchema = z.enum(["LR", "TB"])
export const flowNodeKindSchema = z.enum([
  "start",
  "end",
  "action",
  "decision",
  "screen",
  "system",
])

export const flowNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800).optional(),
    kind: flowNodeKindSchema.optional(),
  })
  .strict()

export const flowEdgeSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    from: z.string().trim().min(1).max(80),
    to: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160).optional(),
  })
  .strict()

export const flowGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    nodeIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  })
  .strict()

export const flowSpecSchema = z
  .object({
    version: z.literal(1),
    direction: flowDirectionSchema,
    nodes: z.array(flowNodeSchema).min(1).max(50),
    edges: z.array(flowEdgeSchema).max(100),
    groups: z.array(flowGroupSchema).max(20).optional(),
  })
  .strict()

export const generateVisualizationInputSchema = z
  .object({
    kind: z.literal("user-flow"),
    prompt: z.string().trim().min(1).max(12_000),
    direction: flowDirectionSchema.optional(),
  })
  .strict()

export const visualizationDataSchema = z
  .object({
    kind: z.literal("user-flow"),
    spec: flowSpecSchema,
  })
  .strict()

export const generateVisualizationResultSchema = z
  .object({
    visualization: visualizationDataSchema,
    verification: z
      .object({
        schema: z.literal("passed"),
        graph: z.literal("passed"),
        semantic: z.literal("skipped"),
      })
      .strict(),
    generation: z
      .object({
        modelId: z.string().min(1),
        attempts: z.number().int().min(1).max(3),
        repairs: z.number().int().min(0).max(2),
        firstPass: z.enum(["passed", "failed"]),
        durationMs: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict()
