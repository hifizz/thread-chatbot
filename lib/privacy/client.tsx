"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { CONSENT_API_PATH, CONSENT_BROADCAST_CHANNEL } from "@/constants/privacy"
import { isSafeAnalyticsEvent, type AnalyticsEvent } from "./analytics-gate"
import type {
  ConsentDecision,
  ConsentState,
  PrivacyConsentResponse,
} from "./types"

type PrivacyContextValue = {
  consent: ConsentState
  analyticsEnabled: boolean
  settingsOpen: boolean
  saving: boolean
  saveFailed: boolean
  setSettingsOpen(open: boolean): void
  decide(decision: ConsentDecision): Promise<void>
  capture(event: AnalyticsEvent): boolean
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null)

function disabledConsent(): ConsentState {
  return { state: "valid", snapshot: {
    policyVersion: "local-rejection-pending",
    necessary: true,
    analytics: false,
    decision: "rejected",
    decidedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revision: 1,
  } }
}

export function PrivacyProvider({ initialConsent, children }: {
  initialConsent: ConsentState
  children: ReactNode
}) {
  const [consent, setConsent] = useState(initialConsent)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const sequence = useRef(0)

  useEffect(() => {
    const channel = "BroadcastChannel" in window
      ? new BroadcastChannel(CONSENT_BROADCAST_CHANNEL)
      : null
    if (channel) {
      channel.onmessage = (message: MessageEvent<ConsentState>) => {
        const next = message.data
        if (!next || !["unresolved", "expired", "valid"].includes(next.state)) return
        setConsent(next)
        if (next.state !== "valid" || !next.snapshot.analytics) {
          window.dispatchEvent(new Event("threadchat:analytics-reset"))
        }
      }
    }
    return () => {
      channel?.close()
      // Provider 以账户身份作为 key；登录、退出或切换账户时清除分析身份。
      window.dispatchEvent(new Event("threadchat:analytics-reset"))
    }
  }, [])

  const decide = useCallback(async (decision: ConsentDecision) => {
    const current = ++sequence.current
    setSaving(true)
    setSaveFailed(false)
    // 撤回必须立即关闭；接受则必须等服务端保存成功后才打开 gate。
    if (decision === "rejected") {
      setConsent(disabledConsent())
      window.dispatchEvent(new Event("threadchat:analytics-reset"))
    }
    try {
      const response = await fetch(CONSENT_API_PATH, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      })
      const result = (await response.json()) as PrivacyConsentResponse
      if (!response.ok || !result.consent) throw new Error("CONSENT_SAVE_FAILED")
      if (current !== sequence.current) return
      setConsent(result.consent)
      setSettingsOpen(false)
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(CONSENT_BROADCAST_CHANNEL)
        channel.postMessage(result.consent)
        channel.close()
      }
      window.dispatchEvent(new CustomEvent("threadchat:consent-changed", {
        detail: result.consent,
      }))
    } catch {
      if (current === sequence.current) setSaveFailed(true)
    } finally {
      if (current === sequence.current) setSaving(false)
    }
  }, [])

  const analyticsEnabled =
    consent.state === "valid" && consent.snapshot.analytics === true
  const capture = useCallback((event: AnalyticsEvent): boolean => {
    if (!analyticsEnabled || !isSafeAnalyticsEvent(event)) return false
    // PostHog 接入只能订阅此事件；本模块不缓存，也不补传同意前事件。
    window.dispatchEvent(new CustomEvent("threadchat:analytics", { detail: event }))
    return true
  }, [analyticsEnabled])
  const value = useMemo(() => ({
    consent,
    analyticsEnabled,
    settingsOpen,
    saving,
    saveFailed,
    setSettingsOpen,
    decide,
    capture,
  }), [consent, analyticsEnabled, settingsOpen, saving, saveFailed, decide, capture])

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

export function usePrivacy(): PrivacyContextValue {
  const context = useContext(PrivacyContext)
  if (!context) throw new Error("PrivacyProvider is required")
  return context
}
