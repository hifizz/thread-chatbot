import { setProjectArchived } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params
  return withActor(
    (actorId) => setProjectArchived(actorId, projectId, true),
    "project_not_found"
  )
}
