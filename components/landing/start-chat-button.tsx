import type { ReactElement } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ROUTES } from "@/constants/routes"
import { LANDING } from "@/constants/landing"

/** 落地页共用 CTA 按钮的 props。内容有默认值，调用处一般无需传参。 */
export interface StartChatButtonProps {
  label?: string // 默认 LANDING.hero.primaryCta.label
  href?: string // 默认 ROUTES.flagship
  size?: "default" | "lg"
  className?: string
}

/**
 * 共用「开始聊天」CTA——server component，用 Base UI Button 的 render 槽
 * 承载 next/link（本仓库 Button 基于 Base UI，asChild 等价写法即 render 槽）。
 * 不读会话、不生成 treeId：未登录的拦截交给旗舰门禁（app/thread-chat/layout.tsx）。
 */
export function StartChatButton({
  label = LANDING.hero.primaryCta.label,
  href = ROUTES.flagship,
  size = "default",
  className,
}: StartChatButtonProps): ReactElement {
  return (
    <Button
      render={<Link href={href} />}
      size={size}
      className={cn(className)}
    >
      {label}
    </Button>
  )
}
