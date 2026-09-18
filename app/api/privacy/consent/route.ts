import { NextResponse } from "next/server"
import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  CONSENT_COOKIE_PATH,
  PRIVACY_REQUEST_BODY_LIMIT_BYTES,
} from "@/constants/privacy"
import { getCurrentUserId } from "@/lib/auth/server"
import { readJsonBody } from "@/lib/http/json-body"
import { isSameOrigin } from "@/lib/http/same-origin"
import {
  consentStateFromPayload,
  createConsentCookiePayload,
  decodeConsentCookie,
  encodeConsentCookie,
} from "@/lib/privacy/consent-cookie"
import { saveAccountConsent } from "@/lib/privacy/consent-store"
import { getRequestConsentState } from "@/lib/privacy/server"
import type {
  ConsentDecision,
  PrivacyConsentResponse,
  PrivacyErrorResponse,
} from "@/lib/privacy/types"

function error(code: PrivacyErrorResponse["code"], status: number) {
  return NextResponse.json({ code } satisfies PrivacyErrorResponse, { status })
}

export async function GET() {
  return NextResponse.json({ consent: await getRequestConsentState() } satisfies PrivacyConsentResponse)
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return error("INVALID_ORIGIN", 403)

  let body: unknown
  try {
    body = await readJsonBody(request, PRIVACY_REQUEST_BODY_LIMIT_BYTES)
  } catch {
    return error("VALIDATION_ERROR", 400)
  }
  const decision =
    body && typeof body === "object" && "decision" in body
      ? (body as { decision?: unknown }).decision
      : null
  if (decision !== "accepted" && decision !== "rejected") {
    return error("VALIDATION_ERROR", 400)
  }

  const previous = decodeConsentCookie(
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CONSENT_COOKIE_NAME}=`))
      ?.slice(CONSENT_COOKIE_NAME.length + 1)
  )
  const payload = createConsentCookiePayload({
    decision: decision satisfies ConsentDecision,
    previous,
  })

  const userId = await getCurrentUserId(request.headers)
  if (userId) {
    try {
      await saveAccountConsent(userId, payload)
    } catch (cause) {
      console.error("[privacy] 同意状态保存失败", cause)
      return error("PRIVACY_PERSISTENCE_FAILED", 503)
    }
  }

  const response = NextResponse.json({
    consent: consentStateFromPayload(payload),
  } satisfies PrivacyConsentResponse)
  response.cookies.set({
    name: CONSENT_COOKIE_NAME,
    value: encodeConsentCookie(payload),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: CONSENT_COOKIE_PATH,
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}

