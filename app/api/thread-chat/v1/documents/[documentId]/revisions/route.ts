import { z } from "zod"
import { getDocumentHistory } from "@/lib/thread-chat/application/documents/service"
import { jsonNoCache, withThreadChatRoute, type RouteContext } from "@/lib/thread-chat/server/route-utils"

export async function GET(request: Request, context: RouteContext<{ documentId: string }>) {
  return withThreadChatRoute(request, async (userId) =>
    jsonNoCache(await getDocumentHistory(userId, z.uuid().parse((await context.params).documentId))))
}
