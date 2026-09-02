import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleStopMessage } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: RouteContext<{ messageId: string }>
) {
  const { messageId } = await context.params
  return handleStopMessage(request, messageId)
}
