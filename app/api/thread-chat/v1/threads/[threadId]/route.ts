import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handlePatchThread } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function PATCH(
  request: Request,
  context: RouteContext<{ threadId: string }>
) {
  const { threadId } = await context.params
  return handlePatchThread(request, threadId)
}
