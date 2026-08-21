import {
  saveTreeErrorResponseSchema,
  saveTreeSuccessResponseSchema,
  type TreeWriteRevisionErrorCode,
} from "@/lib/thread-chat/contracts/save-tree"

export class TreeRevisionError extends Error {
  constructor(
    readonly code: TreeWriteRevisionErrorCode,
    readonly currentRevision?: number
  ) {
    super(
      code === "tree_revision_conflict"
        ? "该对话已在其他页面更新"
        : "当前页面缺少树修订号"
    )
    this.name = "TreeRevisionError"
  }
}

/** 解释整树 PUT 响应；无效的 2xx body 保持历史语义，不推进本地 revision。 */
export async function readSaveTreeRevision(
  response: Response
): Promise<number | null> {
  const body = await response.json().catch(() => null)
  const failure = saveTreeErrorResponseSchema.safeParse(body)

  if (response.status === 409)
    throw new TreeRevisionError(
      "tree_revision_conflict",
      failure.success && failure.data.error.code === "tree_revision_conflict"
        ? failure.data.error.currentRevision
        : undefined
    )
  if (response.status === 428) throw new TreeRevisionError("revision_required")
  if (!response.ok) throw new Error(`PUT /api/branch-trees ${response.status}`)

  const success = saveTreeSuccessResponseSchema.safeParse(body)
  return success.success ? success.data.revision : null
}
