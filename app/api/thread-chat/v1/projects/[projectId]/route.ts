import type { RouteContext } from "@/lib/thread-chat/server/route-utils"
import {
  handleDeleteProject,
  handleGetProject,
  handlePatchProject,
} from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

type Context = RouteContext<{ projectId: string }>

export async function GET(request: Request, context: Context) {
  const { projectId } = await context.params
  return handleGetProject(request, projectId)
}

export async function PATCH(request: Request, context: Context) {
  const { projectId } = await context.params
  return handlePatchProject(request, projectId)
}

export async function DELETE(request: Request, context: Context) {
  const { projectId } = await context.params
  return handleDeleteProject(request, projectId)
}
