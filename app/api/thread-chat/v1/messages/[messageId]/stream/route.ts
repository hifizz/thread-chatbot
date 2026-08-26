import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleMessageStream } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(
  request: Request,
  context: RouteContext<{ messageId: string }>
) {
  const { messageId } = await context.params
  return handleMessageStream(request, messageId)
}
