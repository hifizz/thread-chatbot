import { loadArtifact } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string }> }
) {
  const { artifactId } = await context.params
  return withActor(
    (actorId) => loadArtifact(actorId, artifactId),
    "artifact_not_found"
  )
}
