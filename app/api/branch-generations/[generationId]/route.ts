import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { failStaleGenerationForOwner } from "@/lib/thread-chat-generation/stale-generation-repository"
import { toGenerationSummary } from "@/lib/thread-chat-generation/query-repository"

type RouteContext = { params: Promise<{ generationId: string }> }

export async function GET(_req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId)
    return Response.json(
      { error: { code: "unauthorized", message: "请先登录" } },
      { status: 401 }
    )

  const { generationId } = await params
  if (!isValidTreeId(generationId))
    return Response.json(
      { error: { code: "invalid_id", message: "generationId 必须是 UUID" } },
      { status: 400 }
    )

  const generation = await failStaleGenerationForOwner(userId, generationId)
  if (!generation)
    return Response.json(
      { error: { code: "not_found", message: "generation 不存在" } },
      { status: 404 }
    )
  return Response.json({ generation: toGenerationSummary(generation) })
}
