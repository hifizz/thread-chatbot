export type PublicError = { code: string; requestId: string; retryAfterSeconds?: number }

/** 公开响应不包含内部 exception、SQL、供应商正文或 cookie。 */
export function publicErrorResponse(code: string, status: number, retryAfterSeconds?: number): Response {
  const error: PublicError = { code, requestId: crypto.randomUUID(), ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }
  return Response.json({ ok: false, error }, {
    status,
    headers: { "Cache-Control": "no-store", ...(retryAfterSeconds === undefined ? {} : { "Retry-After": String(retryAfterSeconds) }) },
  })
}
