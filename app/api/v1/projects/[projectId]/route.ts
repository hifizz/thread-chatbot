import {
  deleteProject,
  patchProject,
} from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

type Context = { params: Promise<{ projectId: string }> }

export async function PATCH(request: Request, context: Context) {
  const { projectId } = await context.params
  return withActor(
    (actorId) => patchProject(actorId, projectId, request),
    "project_not_found"
  )
}

export async function DELETE(_request: Request, context: Context) {
  const { projectId } = await context.params
  return withActor(
    (actorId) => deleteProject(actorId, projectId),
    "project_not_found"
  )
}
