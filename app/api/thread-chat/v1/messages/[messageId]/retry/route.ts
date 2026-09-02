import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleRetryMessage } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(
  request: Request,
  context: RouteContext<{ messageId: string }>
) {
  const { messageId } = await context.params
  return handleRetryMessage(request, messageId)
}
