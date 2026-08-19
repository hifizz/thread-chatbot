import { z } from "zod"
import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import {
  switchActiveLeafForOwner,
  TreeCommandError,
} from "@/lib/thread-chat-generation/tree-repository"

type RouteContext = { params: Promise<{ treeId: string }> }

const bodySchema = z.object({
  threadId: z.string().trim().min(1),
  assistantMessageId: z.string().trim().min(1),
  baseRevision: z.number().int().nonnegative(),
})

export async function PATCH(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId)
    return Response.json(
      { error: { code: "unauthorized", message: "请先登录" } },
      { status: 401 }
    )

  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return Response.json(
      { error: { code: "invalid_id", message: "treeId 必须是 UUID" } },
      { status: 400 }
    )
  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success)
    return Response.json(
      { error: { code: "invalid_request", message: "版本切换参数无效" } },
      { status: 400 }
    )

  try {
    return Response.json(
      await switchActiveLeafForOwner({ userId, treeId, ...body.data })
    )
  } catch (error) {
    if (!(error instanceof TreeCommandError)) throw error
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "tree_revision_conflict"
          ? 409
          : 400
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.currentRevision !== undefined
            ? { currentRevision: error.currentRevision }
            : {}),
        },
      },
      { status }
    )
  }
}
