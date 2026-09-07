"use client"

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  DEFAULT_MARKDOWN_FONT,
  MARKDOWN_FONTS,
  MARKDOWN_FONT_SAMPLE,
  MARKDOWN_FONT_STORAGE_KEY,
} from "@/constants/markdown-fonts"

import { usePreviewFont } from "@/hooks/use-preview-font"
import { CodeFontPicker } from "./code-font-picker"

export function MarkdownFontPicker() {
  const { selected, loading, failed, selectFont } = usePreviewFont(
    MARKDOWN_FONTS, DEFAULT_MARKDOWN_FONT, MARKDOWN_FONT_STORAGE_KEY, "proseFont", MARKDOWN_FONT_SAMPLE
  )

  return (
    <aside className="markdown-font-picker" aria-label="阅读字体设置">
      <label htmlFor="markdown-font-select">中文正文</label>
      <NativeSelect
        id="markdown-font-select"
        value={selected}
        onChange={(event) => selectFont(event.target.value)}
      >
        {MARKDOWN_FONTS.map((font) => (
          <NativeSelectOption key={font.id} value={font.id}>{font.label}</NativeSelectOption>
        ))}
      </NativeSelect>
      <small role="status">
        {failed ? "加载失败，请切换字体后重试" : !loading ? "已应用 · 英文保持原样" : "正在加载字体…"}
      </small>
      {(selected === "neo-xihei" || selected === "ipa-original") && (
        <a href="/fonts/markdown/README.txt" target="_blank" rel="noreferrer">字体许可与恢复说明</a>
      )}
      <CodeFontPicker />
    </aside>
  )
}
