import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { requestGenerationStop } from "@/lib/thread-chat-generation/execution-state-repository"
import { toGenerationSummary } from "@/lib/thread-chat-generation/query-repository"
import { abortGenerationLocally } from "@/lib/thread-chat-generation/execution"
import { legacyProtocolGate } from "@/lib/thread-chat/cutover/conversation-authority"

type RouteContext = { params: Promise<{ generationId: string }> }

export async function POST(_req: Request, { params }: RouteContext) {
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
  // Stop 是维护窗口的排空动作：legacy authority 下继续允许；切换后仍稳定返回 410。
  const gate = legacyProtocolGate({
    mutation: false,
    protocol: "branch-generation-stop",
  })
  if (gate) return gate

  const generation = await requestGenerationStop(userId, generationId)
  if (!generation)
    return Response.json(
      { error: { code: "not_found", message: "generation 不存在" } },
      { status: 404 }
    )
  if (generation.status === "stop_requested") {
    abortGenerationLocally(generationId)
  }
  return Response.json({ generation: toGenerationSummary(generation) })
}
