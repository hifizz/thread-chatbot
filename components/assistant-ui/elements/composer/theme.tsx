import { Public_Sans, JetBrains_Mono } from "next/font/google"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"
import styles from "./theme.module.css"

const sans = Public_Sans({ subsets: ["latin"], variable: "--composer-public-sans" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--composer-jetbrains-mono" })

/** 外观可由输入框和 Portal 菜单共享；尺寸、留白由调用方决定。 */
export function ComposerTheme({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(sans.variable, mono.variable, styles.theme, className)} {...props} />
}
