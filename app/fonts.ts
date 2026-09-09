import { Fira_Code, Geist_Mono, Inter, Merriweather, Noto_Sans_SC, PT_Serif } from "next/font/google"

// 正式字体统一在这里声明一次；布局只负责挂载 CSS 变量。
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

const english = Merriweather({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-merriweather",
  display: "swap",
  // 避免生成的 Arial 回退先于显式配置的中文字体命中。
  adjustFontFallback: false,
})
const chinese = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
})
const heading = PT_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-pt-serif",
  display: "swap",
  adjustFontFallback: false,
})
const code = Fira_Code({
  subsets: ["latin"],
  variable: "--font-fira-code",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
})

export const fontVariables = [inter, mono, english, chinese, heading, code]
  .map((font) => font.variable).join(" ")
