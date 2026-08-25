import { bootstrapProject } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params
  return withActor(
    (actorId) => bootstrapProject(actorId, projectId),
    "project_not_found"
  )
}
