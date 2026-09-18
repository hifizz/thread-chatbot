import { cookies } from "next/headers"
import { CONSENT_COOKIE_NAME } from "@/constants/privacy"
import { getCurrentUserId } from "@/lib/auth/server"
import {
  consentStateFromPayload,
  decodeConsentCookie,
} from "./consent-cookie"
import { accountConsentMatchesDevice } from "./consent-store"
import type { ConsentState } from "./types"

export async function getRequestConsentState(): Promise<ConsentState> {
  const store = await cookies()
  const payload = decodeConsentCookie(store.get(CONSENT_COOKIE_NAME)?.value)
  const state = consentStateFromPayload(payload)
  if (state.state !== "valid" || !payload) return state

  const userId = await getCurrentUserId()
  if (!userId) return state
  try {
    return (await accountConsentMatchesDevice(userId, payload))
      ? state
      : { state: "unresolved", analytics: false }
  } catch {
    // 数据库不可用或迁移未就绪时，绝不把可选分析当作已授权。
    return { state: "unresolved", analytics: false }
  }
}

export async function canSendServerAnalytics(): Promise<boolean> {
  const state = await getRequestConsentState()
  return state.state === "valid" && state.snapshot.analytics
}
