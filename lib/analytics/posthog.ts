import {
  POSTHOG_CAPTURE_TIMEOUT_MS,
  POSTHOG_HOST_DEFAULT,
} from "@/constants/analytics"

type EnvironmentSource = Record<string, string | undefined>

export type PosthogConfig = {
  apiKey: string
  host: string
}

/** 缺省不投递；只读服务端 env，绝不回退到 NEXT_PUBLIC 或硬编码密钥。 */
export function resolvePosthogConfig(
  source: EnvironmentSource = process.env
): PosthogConfig | null {
  const apiKey = source.POSTHOG_PROJECT_API_KEY?.trim()
  if (!apiKey) return null
  const host = (source.POSTHOG_HOST?.trim() || POSTHOG_HOST_DEFAULT).replace(
    /\/+$/,
    ""
  )
  try {
    const origin = new URL(host)
    if (origin.protocol !== "https:" && origin.hostname !== "localhost")
      return null
  } catch {
    return null
  }
  return { apiKey, host }
}

export type PosthogCaptureBody = {
  api_key: string
  event: string
  distinct_id: string
  uuid: string
  timestamp: string
  properties: Record<string, string | number | boolean | null>
}

export type PosthogDeliveryResult =
  | { status: "delivered" }
  | { status: "skipped"; reason: "not-configured" }
  | { status: "failed"; errorCategory: string }

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error("PostHog capture timed out")
          error.name = "TimeoutError"
          reject(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function buildCaptureBody(input: {
  config: PosthogConfig
  eventId: string
  name: string
  distinctId: string
  occurredAt: string
  properties: Record<string, string | number | boolean | null>
}): PosthogCaptureBody {
  return {
    api_key: input.config.apiKey,
    event: input.name,
    distinct_id: input.distinctId,
    uuid: input.eventId,
    timestamp: input.occurredAt,
    properties: input.properties,
  }
}

/** 单次 capture 投递；失败由调用方记入诊断日志，绝不向业务链路抛错。 */
export async function deliverPosthogCapture(
  body: PosthogCaptureBody,
  config: PosthogConfig | null,
  timeoutMs = POSTHOG_CAPTURE_TIMEOUT_MS
): Promise<PosthogDeliveryResult> {
  const resolved = config ?? resolvePosthogConfig()
  if (!resolved) return { status: "skipped", reason: "not-configured" }
  try {
    const response = await withTimeout(
      fetch(`${resolved.host}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      timeoutMs
    )
    if (!response.ok) {
      return {
        status: "failed",
        errorCategory:
          response.status === 401 || response.status === 403
            ? "authentication"
            : response.status === 429
              ? "rate_limit"
              : "provider",
      }
    }
    return { status: "delivered" }
  } catch (error) {
    return {
      status: "failed",
      errorCategory:
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "provider",
    }
  }
}
