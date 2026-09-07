"use client"

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { CODE_FONTS, CODE_FONT_SAMPLE, CODE_FONT_STORAGE_KEY, DEFAULT_CODE_FONT } from "@/constants/code-fonts"
import { usePreviewFont } from "@/hooks/use-preview-font"

export function CodeFontPicker() {
  const { selected, loading, failed, selectFont } = usePreviewFont(
    CODE_FONTS, DEFAULT_CODE_FONT, CODE_FONT_STORAGE_KEY, "codeFont", CODE_FONT_SAMPLE
  )
  const font = CODE_FONTS.find((candidate) => candidate.id === selected)!

  return (
    <>
      <label htmlFor="code-font-select">代码块</label>
      <NativeSelect id="code-font-select" value={selected} onChange={(event) => selectFont(event.target.value)}>
        {CODE_FONTS.map((font) => (
          <NativeSelectOption key={font.id} value={font.id}>{font.label}</NativeSelectOption>
        ))}
      </NativeSelect>
      <small role="status">
        {failed ? "加载失败，请切换字体后重试" : loading ? "正在加载字体…" : "system" in font ? "系统字体 · 未安装时使用等宽回退" : "已应用于代码块"}
      </small>
    </>
  )
}
