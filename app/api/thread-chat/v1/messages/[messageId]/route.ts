import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleGetMessage } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: RouteContext<{ messageId: string }>
) {
  const { messageId } = await context.params
  return handleGetMessage(request, messageId)
}
