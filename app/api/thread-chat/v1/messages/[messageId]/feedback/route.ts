import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleSetFeedback } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function PUT(
  request: Request,
  context: RouteContext<{ messageId: string }>
) {
  const { messageId } = await context.params
  return handleSetFeedback(request, messageId)
}
