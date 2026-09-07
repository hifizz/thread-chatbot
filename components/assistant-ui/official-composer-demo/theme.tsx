import { Public_Sans, JetBrains_Mono } from "next/font/google"
import { cn } from "@/lib/utils"
import styles from "./theme.module.css"

const sans = Public_Sans({ subsets: ["latin"], variable: "--demo-public-sans" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--demo-jetbrains-mono" })

export function OfficialComposerTheme({ children, embedded = false }: {
  children: React.ReactNode
  embedded?: boolean
}) {
  return (
    <div className={cn(sans.variable, mono.variable, styles.theme, embedded && styles.embedded)}>
      {children}
    </div>
  )
}
