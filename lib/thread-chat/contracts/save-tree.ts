import { z } from "zod"
import { treeRevisionSchema } from "@/lib/thread-chat/contracts/tree-revision"

/**
 * 整树 PUT 的命令信封。state 的完整消息图约束由领域 parser 负责；
 * 本契约只组合 HTTP 信封与 CAS revision，避免复制领域 schema。
 */
export const saveTreeRequestSchema = z.object({
  state: z.unknown(),
  title: z.unknown().optional(),
  baseRevision: treeRevisionSchema,
})

export const treeWriteRevisionErrorCodeSchema = z.enum([
  "tree_revision_conflict",
  "revision_required",
])

export const saveTreeErrorCodeSchema = z.enum([
  "invalid_tree_state",
  ...treeWriteRevisionErrorCodeSchema.options,
])

export const saveTreeSuccessResponseSchema = z.object({
  ok: z.literal(true),
  revision: treeRevisionSchema,
})

export const saveTreeErrorResponseSchema = z.object({
  error: z.object({
    code: saveTreeErrorCodeSchema,
    message: z.string().min(1),
    currentRevision: treeRevisionSchema.optional(),
  }),
})

export type SaveTreeRequest = z.infer<typeof saveTreeRequestSchema>
export type SaveTreeErrorCode = z.infer<typeof saveTreeErrorCodeSchema>
export type TreeWriteRevisionErrorCode = z.infer<
  typeof treeWriteRevisionErrorCodeSchema
>

export const SAVE_TREE_ERROR_STATUS = {
  invalid_tree_state: 400,
  tree_revision_conflict: 409,
  revision_required: 428,
} as const satisfies Record<SaveTreeErrorCode, number>

export const SAVE_TREE_REVISION_ERRORS = {
  tree_revision_conflict: {
    code: "tree_revision_conflict",
    message: "该对话已在其他页面更新",
  },
  revision_required: {
    code: "revision_required",
    message: "消息图存盘必须携带 baseRevision",
  },
} as const satisfies Record<
  TreeWriteRevisionErrorCode,
  { code: TreeWriteRevisionErrorCode; message: string }
>
