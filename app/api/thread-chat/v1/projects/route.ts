import { handleListProjects } from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleListProjects(request)
}
