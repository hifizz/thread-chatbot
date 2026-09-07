import { Brawler, Geist_Mono, Inter, Lora, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  display: "swap",
  preload: false,
})

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  display: "swap",
  preload: false,
})

const brawler = Brawler({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-brawler",
  display: "swap",
})

const lora = Lora({
  subsets: ["latin"],
  // 英文常规字重匹配到 500，正文仍用 400，保留中文原有粗细。
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  display: "swap",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        lora.variable,
        brawler.variable,
        notoSansSC.variable,
        notoSerifSC.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
