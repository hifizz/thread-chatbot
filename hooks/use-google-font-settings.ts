"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  GOOGLE_FONT_CHANGE_EVENT, GOOGLE_FONT_TARGETS,
  type GoogleFontTarget,
} from "@/constants/google-fonts"
import {
  clearGoogleFontTarget, parseGoogleFontName, readGoogleFontPreferences,
  saveGoogleFontPreferences, type GoogleFontPreferences,
} from "@/lib/chat/google-font-preferences"
import { loadGoogleFont } from "@/lib/chat/load-google-font"

type FontStatus = { loading?: boolean; message: string; error?: boolean }

export function useGoogleFontSettings() {
  const [preferences, setPreferences] = useState(readGoogleFontPreferences)
  const [statuses, setStatuses] = useState<Partial<Record<GoogleFontTarget, FontStatus>>>({})
  const revisions = useRef<Partial<Record<GoogleFontTarget, number>>>({})

  const apply = useCallback(async (input: string, target: GoogleFontTarget, remember = true) => {
    const revision = (revisions.current[target] ?? 0) + 1
    revisions.current[target] = revision
    const destination = GOOGLE_FONT_TARGETS.find(({ id }) => id === target)!
    setStatuses((previous) => ({ ...previous, [target]: { loading: true, message: "正在加载字体…" } }))
    try {
      const name = parseGoogleFontName(input)
      const alias = await loadGoogleFont(name, target, destination.sample)
      if (revisions.current[target] !== revision) return
      document.documentElement.style.setProperty(destination.variable, `"${alias}"`)
      const next = readGoogleFontPreferences()
      next.active[target] = name
      if (remember) {
        next.recent = [name, ...next.recent.filter((item) => item.toLowerCase() !== name.toLowerCase())]
      }
      saveGoogleFontPreferences(next, target)
      setStatuses((previous) => ({ ...previous, [target]: { message: `已应用 ${name}` } }))
    } catch (error) {
      if (revisions.current[target] !== revision) return
      const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "字体加载超时，请检查网络后重试"
        : error instanceof Error && error.name !== "TypeError"
          ? error.message : "无法加载 Google 字体，请检查网络后重试"
      setStatuses((previous) => ({ ...previous, [target]: { error: true, message } }))
    }
  }, [])

  useEffect(() => {
    const revisionMap = revisions.current
    function sync(event: Event) {
      const { preferences: next, target } = (event as CustomEvent<{ preferences: GoogleFontPreferences; target: GoogleFontTarget }>).detail
      revisionMap[target] = (revisionMap[target] ?? 0) + 1
      setPreferences(next)
      if (!next.active[target]) {
        setStatuses((previous) => ({ ...previous, [target]: { message: "已恢复预设字体" } }))
      }
    }
    window.addEventListener(GOOGLE_FONT_CHANGE_EVENT, sync)
    // 等客户端挂载完成后恢复；每个位置有独立版本号，旧请求不会覆盖新的选择。
    let mounted = true
    void Promise.resolve().then(() => {
      if (!mounted) return
      const saved = readGoogleFontPreferences()
      for (const { id } of GOOGLE_FONT_TARGETS) {
        const name = saved.active[id]
        if (name) void apply(name, id, false)
      }
    })
    return () => {
      mounted = false
      window.removeEventListener(GOOGLE_FONT_CHANGE_EVENT, sync)
      for (const { id } of GOOGLE_FONT_TARGETS) {
        revisionMap[id] = (revisionMap[id] ?? 0) + 1
      }
    }
  }, [apply])

  return { preferences, statuses, apply, reset: clearGoogleFontTarget }
}
