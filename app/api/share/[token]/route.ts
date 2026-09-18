import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleGetPublicShare } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: RouteContext<{ token: string }>
) {
  const { token } = await context.params
  return handleGetPublicShare(request, token)
}
