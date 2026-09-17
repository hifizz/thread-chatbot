/** 在分配完整请求体之前限制字节数，供小型公开 JSON 写入接口复用。 */
export async function readJsonBody(request: Request, limitBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new Error("INVALID_BODY_LIMIT")
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
  if (type !== "application/json") throw new Error("VALIDATION_ERROR")
  const length = request.headers.get("content-length")
  if (length && (!/^\d+$/.test(length) || Number(length) > limitBytes)) throw new Error("VALIDATION_ERROR")
  const reader = request.body?.getReader()
  if (!reader) throw new Error("VALIDATION_ERROR")
  let total = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limitBytes) {
        await reader.cancel()
        throw new Error("VALIDATION_ERROR")
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
}
