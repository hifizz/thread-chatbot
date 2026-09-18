import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { BETA_INVITE_AAD, BETA_INVITE_TOKEN_BYTES } from "@/constants/beta-access"

const VERSION = "v1"

function encryptionKey(): Buffer {
  const encoded = process.env.BETA_INVITE_ENCRYPTION_KEY?.trim()
  if (!encoded) throw new Error("BETA_INVITE_ENCRYPTION_KEY_NOT_CONFIGURED")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) throw new Error("BETA_INVITE_ENCRYPTION_KEY_INVALID")
  return key
}

export function createInviteToken(): string {
  return randomBytes(BETA_INVITE_TOKEN_BYTES).toString("base64url")
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function encryptInvitePayload(payload: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  cipher.setAAD(Buffer.from(BETA_INVITE_AAD, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ])
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptInvitePayload<T>(value: string): T {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".")
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra !== undefined
  )
    throw new Error("BETA_INVITE_PAYLOAD_INVALID")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url")
  )
  decipher.setAAD(Buffer.from(BETA_INVITE_AAD, "utf8"))
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString("utf8")) as T
}
