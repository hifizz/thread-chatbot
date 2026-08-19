import { z } from "zod"
import { treeRevisionSchema } from "@/lib/thread-chat/contracts/tree-revision"

export const switchActiveLeafRequestSchema = z.object({
  threadId: z.string().trim().min(1),
  assistantMessageId: z.string().trim().min(1),
  baseRevision: treeRevisionSchema,
})

export const switchActiveLeafFailureReasonSchema = z.enum([
  "not_found",
  "tree_revision_conflict",
  "invalid_turn",
])

export const switchActiveLeafErrorCodeSchema = z.enum([
  "unauthorized",
  "invalid_id",
  "invalid_request",
  ...switchActiveLeafFailureReasonSchema.options,
])

export const switchActiveLeafSuccessResponseSchema = z.object({
  revision: treeRevisionSchema,
  thread: z.object({
    id: z.string().min(1),
    activeLeafMessageId: z.string().min(1),
  }),
})

export const switchActiveLeafErrorResponseSchema = z.object({
  error: z.object({
    code: switchActiveLeafErrorCodeSchema,
    message: z.string().min(1),
    currentRevision: treeRevisionSchema.optional(),
  }),
})

export type SwitchActiveLeafRequest = z.infer<
  typeof switchActiveLeafRequestSchema
>
export type SwitchActiveLeafFailureReason = z.infer<
  typeof switchActiveLeafFailureReasonSchema
>
export type SwitchActiveLeafErrorCode = z.infer<
  typeof switchActiveLeafErrorCodeSchema
>
export type SwitchActiveLeafSuccessResponse = z.infer<
  typeof switchActiveLeafSuccessResponseSchema
>

export const SWITCH_ACTIVE_LEAF_ERROR_STATUS = {
  unauthorized: 401,
  invalid_id: 400,
  invalid_request: 400,
  not_found: 404,
  tree_revision_conflict: 409,
  invalid_turn: 400,
} as const satisfies Record<SwitchActiveLeafErrorCode, number>

export const SWITCH_ACTIVE_LEAF_ROUTE_ERRORS = {
  unauthorized: { code: "unauthorized", message: "请先登录" },
  invalid_id: { code: "invalid_id", message: "treeId 必须是 UUID" },
  invalid_request: { code: "invalid_request", message: "版本切换参数无效" },
} as const satisfies Record<
  "unauthorized" | "invalid_id" | "invalid_request",
  { code: SwitchActiveLeafErrorCode; message: string }
>
