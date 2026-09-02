import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleAddProjectFile } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

type Context = RouteContext<{ projectId: string }>

export async function POST(request: Request, context: Context) {
  const { projectId } = await context.params
  return handleAddProjectFile(request, projectId)
}
