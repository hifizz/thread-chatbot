import type { ReactElement } from "react"

import { cn } from "@/lib/utils"
import { LANDING } from "@/constants/landing"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

/** 「画布工作台」展示段：标题 + 描述 + 一块画布分支示意占位。 */
export function CanvasShowcase({ className }: SectionProps): ReactElement {
  const { title, description } = LANDING.canvasShowcase

  return (
    <section
      className={cn(
        "grid items-center gap-8 py-16 md:grid-cols-2",
        className
      )}
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          {description}
        </p>
      </div>

      {/* 画布示意：几枚节点用连线铺开，纯装饰占位（media 待补） */}
      <div
        aria-hidden
        className="relative aspect-[4/3] overflow-hidden rounded-2xl border bg-card p-6 shadow-sm"
      >
        <div className="absolute top-6 left-6 h-14 w-40 rounded-xl border bg-muted/60" />
        <div className="absolute top-1/2 left-1/2 h-14 w-40 -translate-x-1/2 rounded-xl border border-primary/40 bg-primary/10" />
        <div className="absolute right-6 bottom-6 h-14 w-40 rounded-xl border bg-muted/60" />
        <div className="absolute right-8 bottom-1/3 h-14 w-36 rounded-xl border bg-muted/40" />
      </div>
    </section>
  )
}
