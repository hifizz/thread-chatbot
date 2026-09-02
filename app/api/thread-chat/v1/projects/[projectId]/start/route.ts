import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleStartProject } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(
  request: Request,
  context: RouteContext<{ projectId: string }>
) {
  const { projectId } = await context.params
  return handleStartProject(request, projectId)
}
