import { readPublicShare } from "@/lib/thread-chat/application/sharing"
import { SHARE_UNAVAILABLE } from "@/constants/sharing"
import { shareJson } from "@/lib/thread-chat/server/sharing-http"

export const dynamic = "force-dynamic"
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const result = await readPublicShare((await context.params).token)
    return result ? shareJson(result) : shareJson({ error: SHARE_UNAVAILABLE }, 404)
  } catch { return shareJson({ error: SHARE_UNAVAILABLE }, 503) }
}
