import { BetaHttpError, betaErrorResponse } from "@/lib/beta/http"
import { recordBetaEmailEvent } from "@/lib/beta/email-events"
import { verifyEmailWebhook } from "@/lib/email/client"

export async function POST(request: Request) {
  try {
    const eventId = request.headers.get("svix-id")
    if (!eventId)
      throw new BetaHttpError("WEBHOOK_ID_REQUIRED", "缺少事件 ID", 400)
    const payload = await request.text()
    let event
    try {
      event = verifyEmailWebhook(payload, request.headers)
    } catch {
      throw new BetaHttpError("WEBHOOK_SIGNATURE_INVALID", "签名无效", 401)
    }
    const result = await recordBetaEmailEvent({ eventId, event })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return betaErrorResponse(error)
  }
}
