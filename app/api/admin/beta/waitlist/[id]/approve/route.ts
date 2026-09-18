import { randomUUID } from "node:crypto"
import { z } from "zod"
import { AdminAccessError, requireAdmin } from "@/lib/admin/auth"
import { assertSameOrigin, betaErrorResponse, BetaHttpError } from "@/lib/beta/http"
import { approveBetaWaitlist, deliverBetaInvite } from "@/lib/beta/invites"
import { isEmailConfigured } from "@/lib/email/client"

const inputSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict()

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request)
    const actor = await requireAdmin()
    if (!isEmailConfigured())
      throw new BetaHttpError("EMAIL_NOT_CONFIGURED", "邮件服务未配置", 503)
    const { reason } = inputSchema.parse(await request.json())
    const { id } = await context.params
    const result = await approveBetaWaitlist({
      waitlistId: z.uuid().parse(id),
      actorId: actor.id,
      reason,
      requestId: request.headers.get("x-request-id") ?? randomUUID(),
    })
    await deliverBetaInvite(result.outboxId)
    return Response.json({ ok: true, inviteId: result.inviteId })
  } catch (error) {
    if (error instanceof AdminAccessError)
      return betaErrorResponse(
        new BetaHttpError("ADMIN_ACCESS_REQUIRED", error.message, error.status)
      )
    if (error instanceof z.ZodError)
      return betaErrorResponse(
        new BetaHttpError("VALIDATION_ERROR", "请求参数不合法", 400)
      )
    return betaErrorResponse(error)
  }
}
