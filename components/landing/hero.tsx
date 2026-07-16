import type { ReactElement } from "react"

import { cn } from "@/lib/utils"
import { LANDING } from "@/constants/landing"
import { StartChatButton } from "@/components/landing/start-chat-button"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

/** 首屏 Hero：小标签 + 主标题 + 价值主张 + 主 CTA。 */
export function Hero({ className }: SectionProps): ReactElement {
  const { eyebrow, title, subtitle, primaryCta } = LANDING.hero

  return (
    <section
      className={cn(
        "flex flex-col items-center gap-6 py-16 text-center sm:py-24",
        className
      )}
    >
      {eyebrow ? (
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </span>
      ) : null}
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
        {title}
      </h1>
      <p className="max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
        {subtitle}
      </p>
      <StartChatButton
        label={primaryCta.label}
        href={primaryCta.href}
        size="lg"
        className="mt-2"
      />
    </section>
  )
}
