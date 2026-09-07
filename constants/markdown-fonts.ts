/** 中文正文试读候选；英文正文和标题继续使用各自字体。 */
export const MARKDOWN_FONTS = [
  { id: "noto-sans", label: "Noto Sans SC", variable: "--font-noto-sans-sc" },
  { id: "noto-serif", label: "Noto Serif SC · 思源宋体", variable: "--font-noto-serif-sc" },
  { id: "wenkai", label: "霞鹜文楷", family: "LXGW WenKai" },
  { id: "neo-xihei", label: "霞鹜新晰黑", family: "LXGW Neo XiHei" },
  { id: "ipa-original", label: "IPAex Gothic（恢复原始字体）", family: "IPAexGothic" },
] as const

export type MarkdownFontId = (typeof MARKDOWN_FONTS)[number]["id"]
export const DEFAULT_MARKDOWN_FONT: MarkdownFontId = "noto-sans"
export const MARKDOWN_FONT_STORAGE_KEY = "thread-chat:markdown-font"
export const MARKDOWN_FONT_SAMPLE = "中文阅读字体对比"

export function isMarkdownFontId(value: unknown): value is MarkdownFontId {
  return MARKDOWN_FONTS.some((font) => font.id === value)
}
