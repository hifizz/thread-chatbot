import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleForkThread } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(
  request: Request,
  context: RouteContext<{ threadId: string }>
) {
  const { threadId } = await context.params
  return handleForkThread(request, threadId)
}
