"use client"

import { useEffect, useState } from "react"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  DEFAULT_MARKDOWN_FONT,
  MARKDOWN_FONTS,
  MARKDOWN_FONT_SAMPLE,
  MARKDOWN_FONT_STORAGE_KEY,
  isMarkdownFontId,
} from "@/constants/markdown-fonts"

export function MarkdownFontPicker() {
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(MARKDOWN_FONT_STORAGE_KEY)
      return isMarkdownFontId(saved) ? saved : DEFAULT_MARKDOWN_FONT
    } catch {
      return DEFAULT_MARKDOWN_FONT
    }
  })
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const font = MARKDOWN_FONTS.find((candidate) => candidate.id === selected)!
    const family = "variable" in font
      ? getComputedStyle(document.documentElement).getPropertyValue(font.variable).trim()
      : `"${font.family}"`

    Promise.all([
      document.fonts.load(`400 16px ${family}`, MARKDOWN_FONT_SAMPLE),
      document.fonts.load(`700 16px ${family}`, MARKDOWN_FONT_SAMPLE),
    ]).then((faces) => {
      if (cancelled) return
      if (faces.some((matches) => matches.length === 0)) throw new Error("字体未加载")
      document.documentElement.dataset.proseFont = selected
      setLoaded(selected)
      setFailed(null)
      try {
        localStorage.setItem(MARKDOWN_FONT_STORAGE_KEY, selected)
      } catch {
        // 存储不可用时仍允许本次页面试读。
      }
    }).catch(() => {
      if (!cancelled) setFailed(selected)
    })

    return () => { cancelled = true }
  }, [selected])

  return (
    <aside className="markdown-font-picker" aria-label="中文正文字体对比">
      <label htmlFor="markdown-font-select">中文正文</label>
      <NativeSelect
        id="markdown-font-select"
        value={selected}
        onChange={(event) => {
          if (isMarkdownFontId(event.target.value)) {
            setFailed(null)
            setSelected(event.target.value)
          }
        }}
      >
        {MARKDOWN_FONTS.map((font) => (
          <NativeSelectOption key={font.id} value={font.id}>{font.label}</NativeSelectOption>
        ))}
      </NativeSelect>
      <small role="status">
        {failed === selected ? "加载失败，请切换字体后重试" : loaded === selected ? "已应用 · 英文保持原样" : "正在加载字体…"}
      </small>
      {(selected === "neo-xihei" || selected === "ipa-original") && (
        <a href="/fonts/markdown/README.txt" target="_blank" rel="noreferrer">字体许可与恢复说明</a>
      )}
    </aside>
  )
}
