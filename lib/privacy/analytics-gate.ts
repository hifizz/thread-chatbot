import {
  PRIVACY_EVENT_NAME_MAX_LENGTH,
  PRIVACY_EVENT_PROPERTY_MAX_LENGTH,
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
      (typeof value !== "string" || value.length <= PRIVACY_EVENT_PROPERTY_MAX_LENGTH)
  )
}

