import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { ThreadChatApiError } from "./errors"

const cursorPayloadSchema = z.strictObject({
  actorId: z.string(),
  status: z.enum(["active", "archived", "all"]),
  updatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
})

function secret(): string {
  return process.env.BETTER_AUTH_SECRET ?? "thread-chat-local-cursor-secret"
}

function signature(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest()
}

export function encodeProjectCursor(input: z.infer<typeof cursorPayloadSchema>) {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url")
  return `${payload}.${signature(payload).toString("base64url")}`
}

export function decodeProjectCursor(
  cursor: string,
  binding: { actorId: string; status: "active" | "archived" | "all" }
) {
  try {
    const [payload, encodedSignature, extra] = cursor.split(".")
    if (!payload || !encodedSignature || extra) throw new Error("shape")
    const actual = Buffer.from(encodedSignature, "base64url")
    const expected = signature(payload)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("signature")
    const decoded = cursorPayloadSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    )
    if (decoded.actorId !== binding.actorId || decoded.status !== binding.status)
      throw new Error("binding")
    return { updatedAt: new Date(decoded.updatedAt), id: decoded.id }
  } catch {
    throw new ThreadChatApiError("invalid_cursor", 400, "Invalid cursor.")
  }
}
