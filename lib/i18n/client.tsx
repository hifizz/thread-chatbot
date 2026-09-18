"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_SETTINGS_PATH, type Locale } from "@/constants/i18n"
import { createTranslator, type MessageKey, type MessageVariables } from "./dictionary"
import type { LocalePreference } from "./resolve-locale"
import type { UpdateLocaleResult } from "./locale-preference"

type I18nContextValue = {
  locale: Locale
  saving: boolean
  syncFailed: boolean
  setLocale(locale: Locale): Promise<void>
  t(key: MessageKey, variables?: MessageVariables): string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function saveDeviceLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
  document.documentElement.lang = locale
}

export function I18nProvider({ locale: initialLocale, source = "default", children }: { locale: Locale; source?: LocalePreference["source"]; children: ReactNode }) {
  const router = useRouter()
  const [locale, setCurrentLocale] = useState(initialLocale)
  const [saving, setSaving] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const requestSequence = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const desiredLocale = useRef<Locale | null>(null)

  useEffect(() => {
    // 手动选择尚未被服务端确认时，忽略旧 RSC 响应。账户切换由 Provider 的 key 重建。
    if (desiredLocale.current && desiredLocale.current !== initialLocale) return
    desiredLocale.current = null
    setCurrentLocale(initialLocale)
    setSyncFailed(false)
    // 只同步账户的明确选择，不把浏览器自动识别固化为设备偏好。
    if (source === "profile") saveDeviceLocale(initialLocale)
  }, [initialLocale, source])
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const setLocale = useCallback(async (nextLocale: Locale) => {
    const sequence = ++requestSequence.current
    desiredLocale.current = nextLocale
    setCurrentLocale(nextLocale)
    saveDeviceLocale(nextLocale)
    setSaving(true)
    setSyncFailed(false)
    // 同一页面多个切换入口共用串行队列，旧请求不会在新请求之后写入账户。
    const task = queue.current.catch(() => {}).then(async () => {
      try {
        const response = await fetch(LOCALE_SETTINGS_PATH, {
          method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: nextLocale }),
        })
        const result = await response.json() as UpdateLocaleResult
        if (!response.ok || result.locale !== nextLocale || result.code) throw new Error("LOCALE_SYNC_FAILED")
        if (sequence === requestSequence.current) router.refresh()
      } catch {
        if (sequence === requestSequence.current) setSyncFailed(true)
      } finally {
        if (sequence === requestSequence.current) setSaving(false)
      }
    })
    queue.current = task
    await task
  }, [router])
  const t = useMemo(() => createTranslator(locale), [locale])
  const value = useMemo(() => ({ locale, saving, syncFailed, setLocale, t }), [locale, saving, syncFailed, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error("I18nProvider is required")
  return context
}

/** 无 Provider 的隔离测试必须显式传入语言，而不是读取全局浏览器状态。 */
export { DEFAULT_LOCALE }
