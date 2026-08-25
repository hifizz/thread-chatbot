import { createProject, listProjects } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function GET(request: Request) {
  return withActor((actorId) => listProjects(actorId, request))
}

export async function POST(request: Request) {
  return withActor((actorId) => createProject(actorId, request))
}
