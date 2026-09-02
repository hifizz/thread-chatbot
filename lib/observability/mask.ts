import { TELEMETRY_REDACTED_VALUE } from "@/constants/observability"

const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|secret|password|passphrase|token|credentials?|attachment(content|text|body)?|page(content|text|body)?|raw(request|response|provider|payload|error)?|provider(payload|response|request|error)|chain[-_]?of[-_]?thought|reasoning|query)$/i
const URL_KEY = /^(url|uri|href|sourceUrl|requestUrl)$/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const API_KEY = /\b(?:sk|pk|api|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi
const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value.replace(/[?#].*$/, "")
  }
}

function sanitizeString(value: string): string {
  return value
    .replace(THINK_BLOCK, TELEMETRY_REDACTED_VALUE)
    .replace(BEARER, TELEMETRY_REDACTED_VALUE)
    .replace(API_KEY, TELEMETRY_REDACTED_VALUE)
    .replace(EMAIL, TELEMETRY_REDACTED_VALUE)
    .replace(PHONE, TELEMETRY_REDACTED_VALUE)
    .replace(URL_PATTERN, (url) => sanitizeUrl(url))
}

export function maskTelemetryValue(
  value: unknown,
  seen = new WeakSet<object>()
): unknown {
  if (typeof value === "string") return sanitizeString(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[CIRCULAR]"
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => maskTelemetryValue(item, seen))
  }

  const masked: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      masked[key] = TELEMETRY_REDACTED_VALUE
    } else if (URL_KEY.test(key) && typeof child === "string") {
      masked[key] = sanitizeUrl(child)
    } else {
      masked[key] = maskTelemetryValue(child, seen)
    }
  }
  return masked
}

export function maskLangfuseExport({ data }: { data: unknown }): unknown {
  return maskTelemetryValue(data)
}
