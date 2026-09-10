import { z } from "zod"
import { requireAdmin } from "@/lib/admin/auth"
import { adminErrorResponse, assertAdminWriteRequest } from "@/lib/admin/http"
import { setDefaultCatalogModel } from "@/lib/model-catalog/repository"
const inputSchema = z.object({ id: z.string().min(1).max(160), version: z.number().int().positive() }).strict()
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin()
    assertAdminWriteRequest(request)
    const input = inputSchema.parse(await request.json())
    return Response.json(await setDefaultCatalogModel(actor.id, input.id, input.version))
  } catch (error) { return adminErrorResponse(error) }
}
