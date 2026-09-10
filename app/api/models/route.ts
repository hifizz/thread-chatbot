import { getCurrentUserId } from "@/lib/auth/server"
import { readPublicModelCatalog } from "@/lib/model-catalog/repository"
import { adminErrorResponse } from "@/lib/admin/http"
export async function GET() {
  try {
    if (!await getCurrentUserId()) return Response.json({ error: "请先登录" }, { status: 401 })
    return Response.json(await readPublicModelCatalog(), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return adminErrorResponse(error) }
}
