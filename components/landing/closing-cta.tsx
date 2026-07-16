import type { ReactElement } from "react"

import { cn } from "@/lib/utils"
import { LANDING } from "@/constants/landing"
import { StartChatButton } from "@/components/landing/start-chat-button"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

/** 收尾 CTA：再给一次「开始聊天」入口。 */
export function ClosingCta({ className }: SectionProps): ReactElement {
  const { hero, closingCta } = LANDING

  return (
    <section
      className={cn(
        "my-16 flex flex-col items-center gap-6 rounded-3xl border bg-card px-6 py-16 text-center text-card-foreground shadow-sm",
        className
      )}
    >
      <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {hero.title}
      </h2>
      <StartChatButton
        label={closingCta.label}
        href={closingCta.href}
        size="lg"
      />
    </section>
  )
}
