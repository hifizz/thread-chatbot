import { z } from "zod"

/** Thread Chat 消息命令可返回的稳定失败码。 */
export const messageActionFailureCodeSchema = z.enum([
  "not_found",
  "invalid_id",
  "invalid_request",
  "invalid_generation_identity",
  "invalid_thread_model",
  "invalid_turn",
  "not_latest_turn",
  "generation_conflict",
  "model_mismatch",
  "tree_revision_conflict",
  "revision_required",
  "persistence_failed",
  "unauthorized",
  "network_error",
])

export const messageActionFailureResponseSchema = z.object({
  error: z.object({
    code: messageActionFailureCodeSchema,
    message: z.string().min(1),
  }),
})

export type MessageActionFailureCode = z.infer<
  typeof messageActionFailureCodeSchema
>
export type MessageActionFailureResponse = z.infer<
  typeof messageActionFailureResponseSchema
>
