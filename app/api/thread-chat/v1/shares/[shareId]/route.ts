import { revokeShare } from "@/lib/thread-chat/application/sharing"
import { shareJson, withShareOwner } from "@/lib/thread-chat/server/sharing-http"

export async function DELETE(request: Request, context: { params: Promise<{ shareId: string }> }) {
  return withShareOwner(request, async (userId) => shareJson({ ok: true, data: await revokeShare(userId, (await context.params).shareId) }))
}
