"use client"

import { useLayoutEffect } from "react"
import { previewFontClasses } from "./preview-fonts"
import "../../styles/font-picker.css"

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  DEFAULT_MARKDOWN_FONT,
  MARKDOWN_FONTS,
  MARKDOWN_FONT_SAMPLE,
  MARKDOWN_FONT_STORAGE_KEY,
} from "@/constants/markdown-fonts"

import { usePreviewFont } from "@/hooks/use-preview-font"
import { CodeFontPicker } from "./code-font-picker"
import { GoogleFontPicker } from "./google-font-picker"
import { CUSTOM_GOOGLE_FONT_OPTION } from "@/constants/google-fonts"

export function LocalFontDebugPanel() {
  const hostname = window.location.hostname
  if (process.env.NODE_ENV !== "development" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return null
  return <MarkdownFontPicker />
}

function MarkdownFontPicker() {
  useLayoutEffect(() => {
    document.documentElement.classList.add(...previewFontClasses)
    return () => document.documentElement.classList.remove(...previewFontClasses)
  }, [])
  const { selected, override, loading, failed, selectFont } = usePreviewFont(
    MARKDOWN_FONTS, DEFAULT_MARKDOWN_FONT, MARKDOWN_FONT_STORAGE_KEY, "proseFont", MARKDOWN_FONT_SAMPLE
  )

  return (
    <aside className="markdown-font-picker" aria-label="阅读字体设置">
      <label htmlFor="markdown-font-select">中文正文</label>
      <NativeSelect
        id="markdown-font-select"
        value={override ? CUSTOM_GOOGLE_FONT_OPTION : selected}
        onChange={(event) => selectFont(event.target.value)}
      >
        {override && <NativeSelectOption value={CUSTOM_GOOGLE_FONT_OPTION} disabled>Google · {override}</NativeSelectOption>}
        {MARKDOWN_FONTS.map((font) => (
          <NativeSelectOption key={font.id} value={font.id}>{font.label}</NativeSelectOption>
        ))}
      </NativeSelect>
      <small role="status">
        {override ? "Google 字体 · 可在下方管理" : failed ? "加载失败，请切换字体后重试" : !loading ? "已应用 · 英文保持原样" : "正在加载字体…"}
      </small>
      {(selected === "neo-xihei" || selected === "ipa-original") && (
        <a href="/fonts/markdown/README.txt" target="_blank" rel="noreferrer">字体许可与恢复说明</a>
      )}
      <CodeFontPicker />
      <GoogleFontPicker />
    </aside>
  )
}
