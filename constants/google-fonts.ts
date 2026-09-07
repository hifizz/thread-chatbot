/** 动态试读字体的作用范围、存储和网络边界。 */
export const GOOGLE_FONT_TARGETS = [
  { id: "english", label: "英文正文", variable: "--font-google-english", sample: "Reading English text" },
  { id: "chinese", label: "中文正文", variable: "--font-google-chinese", sample: "中文阅读字体" },
  { id: "heading", label: "标题", variable: "--font-google-heading", sample: "Heading Title" },
  { id: "code", label: "代码块", variable: "--font-google-code", sample: "const value = 0;" },
] as const
export type GoogleFontTarget = (typeof GOOGLE_FONT_TARGETS)[number]["id"]
export const GOOGLE_FONT_STORAGE_KEY = "thread-chat:google-fonts:v1"
export const GOOGLE_FONT_CHANGE_EVENT = "thread-chat:google-font-change"
export const CUSTOM_GOOGLE_FONT_OPTION = "google-override"
export const GOOGLE_FONT_TIMEOUT_MS = 20000
export const GOOGLE_FONT_CSS_ENDPOINT = "https://fonts.googleapis.com/css2"
export const GOOGLE_FONT_STYLE_REQUESTS = [":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", ""] as const
/** 限定正文的语言范围，防止中文字体覆盖英文，或反过来。 */
export const GOOGLE_FONT_SCRIPT_RANGES = {
  english: [[0x0, 0x24f], [0x1e00, 0x1eff], [0x2000, 0x206f]],
  chinese: [[0x2e80, 0x9fff], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xffef], [0x20000, 0x323af]],
} as const
