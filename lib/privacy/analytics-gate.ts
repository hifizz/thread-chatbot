import {
  PRIVACY_EVENT_NAME_MAX_LENGTH,
  PRIVACY_EVENT_PROPERTY_MAX_LENGTH,
  PRIVACY_SERVER_FACT_EVENT_PREFIXES,
} from "@/constants/privacy"

export type AnalyticsPrimitive = string | number | boolean | null
export type AnalyticsProperties = Readonly<Record<string, AnalyticsPrimitive>>
export type AnalyticsEvent = {
  name: string
  properties?: AnalyticsProperties
}

const forbiddenProperty = /(?:content|message|prompt|query|url|token|secret|password|cookie)/i

export function isSafeAnalyticsEvent(event: AnalyticsEvent): boolean {
  if (!/^[a-z][a-z0-9_.-]*$/.test(event.name) || event.name.length > PRIVACY_EVENT_NAME_MAX_LENGTH) {
    return false
  }
  return Object.entries(event.properties ?? {}).every(
    ([key, value]) =>
      !forbiddenProperty.test(key) &&
      key.length <= PRIVACY_EVENT_NAME_MAX_LENGTH &&
      (value === null ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        (typeof value === "string" &&
          value.length <= PRIVACY_EVENT_PROPERTY_MAX_LENGTH))
  )
}

/**
 * 客户端可提交事件：hygiene 之上再排除服务端事实命名空间，
 * 防止伪造 generation.completed、credit.exhausted 等成功/账务事实。
 * 服务端事实事件只走 lib/analytics/dispatch，不经过此 gate。
 */
export function isClientAnalyticsEvent(event: AnalyticsEvent): boolean {
  if (!isSafeAnalyticsEvent(event)) return false
  return !PRIVACY_SERVER_FACT_EVENT_PREFIXES.some((prefix) =>
    event.name.startsWith(prefix)
  )
}

