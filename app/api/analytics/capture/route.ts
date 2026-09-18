import { createHash } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { ANALYTICS_CAPTURE_BODY_LIMIT_BYTES } from "@/constants/analytics"
import { CONSENT_COOKIE_NAME } from "@/constants/privacy"
import {
  buildCaptureBody,
  deliverPosthogCapture,
  resolvePosthogConfig,
} from "@/lib/analytics/posthog"
import { getCurrentUserId } from "@/lib/auth/server"
import { readJsonBody } from "@/lib/http/json-body"
import { isSameOrigin } from "@/lib/http/same-origin"
import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { logDiagnostic } from "@/lib/observability/diagnostic-log"
import { pseudonymizeUserId } from "@/lib/observability/identity"
import {
  isClientAnalyticsEvent,
  type AnalyticsEvent,
} from "@/lib/privacy/analytics-gate"
import { decodeConsentCookie } from "@/lib/privacy/consent-cookie"
import { getRequestConsentState } from "@/lib/privacy/server"

function deviceDistinctId(deviceId: string): string {
  return `dev_${createHash("sha256").update(deviceId).digest("hex").slice(0, 32)}`
}

function noStore(status = 204) {
  return new NextResponse(null, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}

/**
 * 自有分析事件入口：浏览器只把 PrivacyProvider 放行的事件发到同源端点，
 * 服务端按签名 Cookie + 账户记录重查授权后再转发 PostHog。
 * 一律返回 204，不向前端泄露授权状态、配置或投递结果。
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return noStore()

  let body: unknown
  try {
    body = await readJsonBody(request, ANALYTICS_CAPTURE_BODY_LIMIT_BYTES)
  } catch {
    return noStore()
  }
  const event = body as AnalyticsEvent
  if (!isClientAnalyticsEvent(event)) return noStore()

  const [consent, store, config, posthogConfig] = await Promise.all([
    getRequestConsentState(),
    cookies(),
    Promise.resolve(resolveObservabilityConfig()),
    Promise.resolve(resolvePosthogConfig()),
  ])
  if (
    consent.state !== "valid" ||
    consent.snapshot.analytics !== true ||
    !posthogConfig
  ) {
    return noStore()
  }

  const payload = decodeConsentCookie(
    store.get(CONSENT_COOKIE_NAME)?.value
  )
  const userId = await getCurrentUserId(request.headers)
  const distinctId = userId
    ? config.idSalt
      ? pseudonymizeUserId(userId, config.idSalt)
      : payload
        ? deviceDistinctId(payload.deviceId)
        : null
    : payload
      ? deviceDistinctId(payload.deviceId)
      : null
  if (!distinctId) return noStore()

  const result = await deliverPosthogCapture(
    buildCaptureBody({
      config: posthogConfig,
      eventId: crypto.randomUUID().replaceAll("-", ""),
      name: event.name,
      distinctId,
      occurredAt: new Date().toISOString(),
      properties: {
        ...(event.properties ?? {}),
        environment: config.environment,
        release: config.release,
        $lib: "thread-chat-relay",
      },
    }),
    posthogConfig
  )
  if (result.status === "failed") {
    logDiagnostic(
      AI_DIAGNOSTIC_EVENTS.analyticsDeliveryFailed,
      { eventName: event.name, errorCategory: result.errorCategory },
      undefined,
      "warn"
    )
  }
  return noStore()
}
