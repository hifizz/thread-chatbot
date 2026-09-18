export class BetaHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "BetaHttpError"
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  const expected = process.env.BETTER_AUTH_URL
  if (!origin || !expected || origin !== new URL(expected).origin)
    throw new BetaHttpError("INVALID_ORIGIN", "请求来源不合法", 403)
}

export function betaErrorResponse(error: unknown): Response {
  if (error instanceof BetaHttpError)
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status }
    )
  return Response.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } },
    { status: 500 }
  )
}
