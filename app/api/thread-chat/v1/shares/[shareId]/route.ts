import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleRevokeShare } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function DELETE(
  request: Request,
  context: RouteContext<{ shareId: string }>
) {
  const { shareId } = await context.params
  return handleRevokeShare(request, shareId)
}
