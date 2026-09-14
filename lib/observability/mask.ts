import { TELEMETRY_REDACTED_VALUE } from "@/constants/observability"

const SENSITIVE_KEY =
  /^(authorization|cookie|api[-_]?key|secret|password|token|credentials)$/i

export function maskTelemetryValue(
  value: unknown,
  seen = new WeakSet<object>()
): unknown {
  if (typeof value === "string") return value
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
    } else {
      masked[key] = maskTelemetryValue(child, seen)
    }
  }
  return masked
}

export function maskLangfuseExport({ data }: { data: unknown }): unknown {
  return maskTelemetryValue(data)
}
