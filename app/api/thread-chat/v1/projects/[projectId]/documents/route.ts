import { z } from "zod"
import { getProjectDocuments } from "@/lib/thread-chat/application/documents/service"
import { jsonNoCache, withThreadChatRoute, type RouteContext } from "@/lib/thread-chat/server/route-utils"

export async function GET(request: Request, context: RouteContext<{ projectId: string }>) {
  return withThreadChatRoute(request, async (userId) => {
    const projectId = z.uuid().parse((await context.params).projectId)
    return jsonNoCache(await getProjectDocuments(userId, projectId))
  })
}
