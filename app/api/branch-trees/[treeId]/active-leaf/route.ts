import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import {
  SWITCH_ACTIVE_LEAF_ERROR_STATUS,
  SWITCH_ACTIVE_LEAF_ROUTE_ERRORS,
  switchActiveLeafErrorResponseSchema,
  switchActiveLeafRequestSchema,
  switchActiveLeafSuccessResponseSchema,
  type SwitchActiveLeafErrorCode,
} from "@/lib/thread-chat/contracts/switch-active-leaf"
import {
  switchActiveLeafForOwner,
  TreeCommandError,
} from "@/lib/thread-chat-generation/tree-repository"

type RouteContext = { params: Promise<{ treeId: string }> }

function activeLeafErrorResponse(
  code: SwitchActiveLeafErrorCode,
  message: string,
  currentRevision?: number
) {
  return Response.json(
    switchActiveLeafErrorResponseSchema.parse({
      error: {
        code,
        message,
        ...(currentRevision !== undefined ? { currentRevision } : {}),
      },
    }),
    { status: SWITCH_ACTIVE_LEAF_ERROR_STATUS[code] }
  )
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) {
    const error = SWITCH_ACTIVE_LEAF_ROUTE_ERRORS.unauthorized
    return activeLeafErrorResponse(error.code, error.message)
  }

  const { treeId } = await params
  if (!isValidTreeId(treeId)) {
    const error = SWITCH_ACTIVE_LEAF_ROUTE_ERRORS.invalid_id
    return activeLeafErrorResponse(error.code, error.message)
  }
  const body = switchActiveLeafRequestSchema.safeParse(
    await req.json().catch(() => null)
  )
  if (!body.success) {
    const error = SWITCH_ACTIVE_LEAF_ROUTE_ERRORS.invalid_request
    return activeLeafErrorResponse(error.code, error.message)
  }

  try {
    return Response.json(
      switchActiveLeafSuccessResponseSchema.parse(
        await switchActiveLeafForOwner({ userId, treeId, ...body.data })
      )
    )
  } catch (error) {
    if (!(error instanceof TreeCommandError)) throw error
    return activeLeafErrorResponse(
      error.code,
      error.message,
      error.currentRevision
    )
  }
}
