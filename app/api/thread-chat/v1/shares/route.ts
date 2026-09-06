import { createShare, listShares } from "@/lib/thread-chat/application/sharing"
import { createShareSchema, listSharesSchema } from "@/lib/thread-chat/sharing/contracts"
import { readShareRequest, shareJson, withShareOwner } from "@/lib/thread-chat/server/sharing-http"

export const dynamic = "force-dynamic"
export async function POST(request: Request) {
  return withShareOwner(request, async (userId) => {
    const input = createShareSchema.parse(await readShareRequest(request))
    const result = await createShare(userId, input)
    return shareJson({ ok: true, replayed: result.replayed, data: result.result })
  })
}
export async function GET(request: Request) {
  return withShareOwner(request, async (userId) => {
    const input = listSharesSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return shareJson({ ok: true, data: await listShares(userId, input.resourceType, input.resourceId) })
  })
}
