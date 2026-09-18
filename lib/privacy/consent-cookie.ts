import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_POLICY_VERSION,
} from "@/constants/privacy"
import type {
  ConsentCookiePayload,
  ConsentDecision,
  ConsentSnapshot,
  ConsentState,
} from "./types"

function signingSecret(): string {
  const secret = process.env.PRIVACY_COOKIE_SECRET || process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("PRIVACY_COOKIE_SECRET_MISSING")
  return secret
}

function signature(encoded: string): Buffer {
  return createHmac("sha256", signingSecret()).update(encoded).digest()
}

function isConsentCookiePayload(value: unknown): value is ConsentCookiePayload {
  if (!value || typeof value !== "object") return false
  const payload = value as Record<string, unknown>
  return (
    payload.policyVersion === CONSENT_POLICY_VERSION &&
    payload.necessary === true &&
    (payload.decision === "accepted" || payload.decision === "rejected") &&
    payload.analytics === (payload.decision === "accepted") &&
    typeof payload.decidedAt === "string" &&
    typeof payload.expiresAt === "string" &&
    Number.isSafeInteger(payload.revision) &&
    Number(payload.revision) >= 1 &&
    typeof payload.deviceId === "string" &&
    /^[0-9a-f-]{36}$/i.test(payload.deviceId)
  )
}

export function encodeConsentCookie(payload: ConsentCookiePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${encoded}.${signature(encoded).toString("base64url")}`
}

export function decodeConsentCookie(value: string | undefined): ConsentCookiePayload | null {
  if (!value) return null
  const [encoded, supplied, extra] = value.split(".")
  if (!encoded || !supplied || extra) return null
  try {
    const expected = signature(encoded)
    const actual = Buffer.from(supplied, "base64url")
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    return isConsentCookiePayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createConsentCookiePayload(input: {
  decision: ConsentDecision
  previous?: ConsentCookiePayload | null
  now?: Date
}): ConsentCookiePayload {
  const now = input.now ?? new Date()
  return {
    policyVersion: CONSENT_POLICY_VERSION,
    necessary: true,
    analytics: input.decision === "accepted",
    decision: input.decision,
    decidedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + CONSENT_COOKIE_MAX_AGE_SECONDS * 1_000
    ).toISOString(),
    revision: (input.previous?.revision ?? 0) + 1,
    deviceId: input.previous?.deviceId ?? randomUUID(),
  }
}

export function consentStateFromPayload(
  payload: ConsentCookiePayload | null,
  now = new Date()
): ConsentState {
  if (!payload) return { state: "unresolved", analytics: false }
  const expiresAt = new Date(payload.expiresAt)
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    return { state: "expired", analytics: false }
  }
  const snapshot: ConsentSnapshot = {
    policyVersion: payload.policyVersion,
    necessary: true,
    analytics: payload.analytics,
    decision: payload.decision,
    decidedAt: payload.decidedAt,
    expiresAt: payload.expiresAt,
    revision: payload.revision,
  }
  return { state: "valid", snapshot }
}
