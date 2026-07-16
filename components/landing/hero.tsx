import type { ReactElement } from "react"

import { cn } from "@/lib/utils"
import { LANDING } from "@/constants/landing"
import { StartChatButton } from "@/components/landing/start-chat-button"
import { GrainGradientBackground } from "@/components/landing/grain-gradient-background"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

/**
 * 首屏 Hero：满一屏（min-h-svh）的 grain-gradient「Wave」动态背景，
 * 上覆一层压暗 scrim 保证浅色文字对比，居中排布小标签 + 主标题 + 价值主张 + 主 CTA。
 */
export function Hero({ className }: SectionProps): ReactElement {
  const { eyebrow, title, subtitle, primaryCta } = LANDING.hero

  return (
    <section
      className={cn(
        "relative isolate flex min-h-svh w-full flex-col items-center justify-center gap-6 px-6 py-24 text-center",
        className
      )}
    >
      {/* 动态背景：铺满首屏（着色器自带深色底 #000a0f） */}
      <GrainGradientBackground className="absolute inset-0 -z-20" />
      {/* 可读性 scrim：轻压暗，浅色文字在暖色/亮部上仍清晰 */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-black/35" />

      {eyebrow ? (
        <span className="inline-flex items-center rounded-full border border-white/25 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm">
          {eyebrow}
        </span>
      ) : null}
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-white drop-shadow-sm sm:text-5xl md:text-6xl">
        {title}
      </h1>
      <p className="max-w-2xl text-base text-pretty text-white/75 sm:text-lg">
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
