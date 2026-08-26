import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import { handleGetArtifact } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: RouteContext<{ artifactId: string }>
) {
  const { artifactId } = await context.params
  return handleGetArtifact(artifactId)
}
