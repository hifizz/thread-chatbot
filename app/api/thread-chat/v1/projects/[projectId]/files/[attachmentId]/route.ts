import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleRemoveProjectFile } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

type Context = RouteContext<{ projectId: string; attachmentId: string }>

export async function DELETE(request: Request, context: Context) {
  const { projectId, attachmentId } = await context.params
  return handleRemoveProjectFile(request, projectId, attachmentId)
}
