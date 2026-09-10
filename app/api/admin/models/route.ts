import { requireAdmin } from "@/lib/admin/auth"
import { adminErrorResponse, assertAdminWriteRequest } from "@/lib/admin/http"
import { readModelCatalog, saveCatalogModel } from "@/lib/model-catalog/repository"
import { modelCatalogWriteSchema } from "@/lib/model-catalog/schema"

export async function GET() {
  try {
    await requireAdmin()
    return Response.json(await readModelCatalog(), { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return adminErrorResponse(error) }
}
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin()
    assertAdminWriteRequest(request)
    const value = modelCatalogWriteSchema.parse(await request.json())
    return Response.json(await saveCatalogModel(actor.id, value))
  } catch (error) { return adminErrorResponse(error) }
}
