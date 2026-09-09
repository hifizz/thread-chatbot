import { Fira_Code, JetBrains_Mono, Noto_Serif_SC } from "next/font/google"

// 仅供本地字体调试面板使用，不加入正式布局。
const firaCode = Fira_Code({ subsets: ["latin"], variable: "--font-fira-code", display: "swap", preload: false })
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-jetbrains-mono", display: "swap", preload: false })
const notoSerif = Noto_Serif_SC({ variable: "--font-noto-serif-sc", display: "swap", preload: false })

export const previewFontClasses = [firaCode.variable, jetBrainsMono.variable, notoSerif.variable]
