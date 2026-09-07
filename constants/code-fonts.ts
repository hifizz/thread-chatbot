/** 代码块字体候选；系统字体不存在时由等宽字体栈回退。 */
export const CODE_FONTS = [
  { id: "fira-code", label: "Fira Code", variable: "--font-fira-code" },
  { id: "jetbrains-mono", label: "JetBrains Mono", variable: "--font-jetbrains-mono" },
  { id: "menlo", label: "Menlo", family: "Menlo", system: true },
  { id: "monaco", label: "Monaco", family: "Monaco", system: true },
  { id: "courier-new", label: "Courier New", family: "Courier New", system: true },
  { id: "monospace", label: "系统等宽字体", family: "monospace", system: true },
] as const

export const DEFAULT_CODE_FONT = "fira-code"
export const CODE_FONT_STORAGE_KEY = "thread-chat:code-font"
export const CODE_FONT_SAMPLE = "const value = 0; // => != ==="
