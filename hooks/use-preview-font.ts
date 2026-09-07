"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { clearGoogleFontTarget, readGoogleFontPreferences } from "@/lib/chat/google-font-preferences"
import { GOOGLE_FONT_CHANGE_EVENT } from "@/constants/google-fonts"

function subscribeGoogleFont(listener: () => void) {
  window.addEventListener(GOOGLE_FONT_CHANGE_EVENT, listener)
  return () => window.removeEventListener(GOOGLE_FONT_CHANGE_EVENT, listener)
}

type PreviewFont = {
  id: string
  variable?: string
  family?: string
  system?: boolean
}

/** 在字体加载成功后应用选择；调用方仅在客户端挂载，避免存储值造成水合差异。 */
export function usePreviewFont(
  fonts: readonly PreviewFont[],
  defaultFont: string,
  storageKey: string,
  attribute: "proseFont" | "codeFont",
  sample: string
) {
  const target = attribute === "proseFont" ? "chinese" : "code"
  const override = useSyncExternalStore(
    subscribeGoogleFont,
    () => readGoogleFontPreferences().active[target] ?? "",
    () => ""
  )
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return fonts.some((font) => font.id === saved) ? saved! : defaultFont
    } catch {
      return defaultFont
    }
  })
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const font = fonts.find((candidate) => candidate.id === selected)!
    const family = font.variable
      ? getComputedStyle(document.documentElement).getPropertyValue(font.variable).trim()
      : font.family === "monospace" ? "monospace" : `"${font.family}"`

    Promise.all([
      document.fonts.load(`400 16px ${family}`, sample),
      document.fonts.load(`700 16px ${family}`, sample),
    ]).then((faces) => {
      if (cancelled) return
      if (!font.system && faces.some((matches) => matches.length === 0)) {
        throw new Error("字体未加载")
      }
      document.documentElement.dataset[attribute] = selected
      setLoaded(selected)
      setFailed(null)
      try {
        localStorage.setItem(storageKey, selected)
      } catch {
        // 存储不可用时仍允许本次页面试读。
      }
    }).catch(() => {
      if (!cancelled) setFailed(selected)
    })

    return () => { cancelled = true }
  }, [selected, fonts, storageKey, attribute, sample])

  return {
    selected,
    override,
    loading: loaded !== selected,
    failed: failed === selected,
    selectFont(value: string) {
      if (fonts.some((font) => font.id === value)) {
        clearGoogleFontTarget(attribute === "proseFont" ? "chinese" : "code")
        setFailed(null)
        setSelected(value)
      }
    },
  }
}
