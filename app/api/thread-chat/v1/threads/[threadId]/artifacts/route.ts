import { z } from "zod"
import { getThreadArtifacts } from "@/lib/thread-chat/application/queries"
import { jsonNoCache, withThreadChatRoute, type RouteContext } from "@/lib/thread-chat/server/route-utils"

export async function GET(request: Request, context: RouteContext<{ threadId: string }>) {
  return withThreadChatRoute(request, async (userId) => {
    const threadId = z.uuid().parse((await context.params).threadId)
    return jsonNoCache(await getThreadArtifacts(userId, threadId))
  })
}
