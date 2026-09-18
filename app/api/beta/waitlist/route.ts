import { z } from "zod"
import { betaErrorResponse } from "@/lib/beta/http"
import { joinBetaWaitlist } from "@/lib/beta/waitlist"

const inputSchema = z
  .object({
    email: z.email().max(320),
    locale: z.enum(["zh-CN", "en"]),
  })
  .strict()

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json())
    await joinBetaWaitlist(input)
    return Response.json({ ok: true, accepted: true }, { status: 202 })
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "请求参数不合法" } },
        { status: 400 }
      )
    return betaErrorResponse(error)
  }
}
