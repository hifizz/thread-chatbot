import { z } from "zod"

export const apiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "COMMAND_ID_CONFLICT",
  "STATE_CONFLICT",
  "MODEL_NOT_ALLOWED",
  "SESSION_NOT_AVAILABLE",
  "INPUT_BUDGET_EXCEEDED",
  "GENERATION_FAILED",
])

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict()

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorDTO = z.infer<typeof apiErrorSchema>

export type CommandResponse<T> =
  | { ok: true; replayed: boolean; data: T }
  | { ok: false; error: ApiErrorDTO }
