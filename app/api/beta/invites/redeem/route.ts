import { randomUUID } from "node:crypto"
import { z } from "zod"
import { getSession } from "@/lib/auth/server"
import { assertSameOrigin, betaErrorResponse, BetaHttpError } from "@/lib/beta/http"
import { redeemBetaInvite } from "@/lib/beta/invites"

const inputSchema = z.object({ token: z.string().trim().min(40).max(128) }).strict()

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await getSession(request.headers)
    if (!session) throw new BetaHttpError("UNAUTHORIZED", "请先登录", 401)
    const input = inputSchema.parse(await request.json())
    const result = await redeemBetaInvite({
      token: input.token,
      userId: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      requestId: request.headers.get("x-request-id") ?? randomUUID(),
    })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "请求参数不合法" } },
        { status: 400 }
      )
    return betaErrorResponse(error)
  }
}
