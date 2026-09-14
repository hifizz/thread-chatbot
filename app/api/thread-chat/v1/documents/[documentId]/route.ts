import { z } from "zod"
import { getProjectDocument } from "@/lib/thread-chat/application/document-service"
import { jsonNoCache, withThreadChatRoute, type RouteContext } from "@/lib/thread-chat/server/route-utils"

export async function GET(request: Request, context: RouteContext<{ documentId: string }>) {
  return withThreadChatRoute(request, async (userId) => {
    const documentId = z.uuid().parse((await context.params).documentId)
    const revisionId = z.uuid().optional().parse(new URL(request.url).searchParams.get("revisionId") ?? undefined)
    return jsonNoCache(await getProjectDocument(userId, documentId, revisionId))
  })
}
