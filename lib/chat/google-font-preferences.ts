import {
  GOOGLE_FONT_CHANGE_EVENT, GOOGLE_FONT_STORAGE_KEY,
  GOOGLE_FONT_TARGETS, type GoogleFontTarget,
} from "@/constants/google-fonts"

export type GoogleFontPreferences = {
  active: Partial<Record<GoogleFontTarget, string>>
  recent: string[]
}

export function parseGoogleFontName(input: string): string {
  let name = input.trim()
  if (/^https?:\/\//i.test(name)) {
    const url = new URL(name)
    const match = url.pathname.match(/^\/(?:noto\/)?specimen\/([^/]+)\/?$/)
    if (url.hostname !== "fonts.google.com" || !match) {
      throw new Error("请粘贴 Google Fonts 字体详情链接，或直接输入字体名称")
    }
    name = decodeURIComponent(match[1].replace(/\+/g, " "))
  }
  name = name.replace(/\s+/g, " ")
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]{0,99}$/.test(name)) {
    throw new Error("请输入有效字体名称，例如 Gelasio 或 Noto Sans SC")
  }
  return name
}

export function readGoogleFontPreferences(): GoogleFontPreferences {
  const preferences: GoogleFontPreferences = { active: {}, recent: [] }
  try {
    const saved = JSON.parse(localStorage.getItem(GOOGLE_FONT_STORAGE_KEY) ?? "null")
    for (const { id } of GOOGLE_FONT_TARGETS) {
      const value = saved?.active?.[id]
      if (typeof value === "string") {
        try { preferences.active[id] = parseGoogleFontName(value) } catch { /* 忽略损坏的保存值。 */ }
      }
    }
    if (Array.isArray(saved?.recent)) {
      for (const value of saved.recent) {
        if (typeof value !== "string") continue
        try {
          const name = parseGoogleFontName(value)
          if (!preferences.recent.includes(name)) preferences.recent.push(name)
        } catch { /* 忽略损坏的保存值。 */ }
      }
    }
  } catch { /* 存储不可用时仍可在当前页面试读。 */ }
  return preferences
}

export function saveGoogleFontPreferences(preferences: GoogleFontPreferences, target: GoogleFontTarget) {
  try { localStorage.setItem(GOOGLE_FONT_STORAGE_KEY, JSON.stringify(preferences)) } catch { /* 允许不持久化。 */ }
  window.dispatchEvent(new CustomEvent(GOOGLE_FONT_CHANGE_EVENT, { detail: { preferences, target } }))
}

export function clearGoogleFontTarget(target: GoogleFontTarget) {
  const preferences = readGoogleFontPreferences()
  delete preferences.active[target]
  document.documentElement.style.removeProperty(GOOGLE_FONT_TARGETS.find(({ id }) => id === target)!.variable)
  saveGoogleFontPreferences(preferences, target)
}
