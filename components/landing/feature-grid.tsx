import type { ComponentType, ReactElement } from "react"
import { Database, Sparkles, Wallet } from "lucide-react"

import { cn } from "@/lib/utils"
import { LANDING } from "@/constants/landing"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

/**
 * 内容里的 icon 是 lucide-react 图标名（小写）→ 组件的映射。
 * 未命中的名字返回 undefined，渲染层就不显示图标（不让构建失败）。
 */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  database: Database,
  sparkles: Sparkles,
  wallet: Wallet,
}

/** 卖点卡片网格：从 LANDING.features 渲染。 */
export function FeatureGrid({ className }: SectionProps): ReactElement {
  const { features } = LANDING

  return (
    <section
      className={cn("grid gap-4 py-16 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {features.map((feature) => {
        const Icon = feature.icon ? ICONS[feature.icon] : undefined
        return (
          <div
            key={feature.title}
            className="flex flex-col gap-3 rounded-2xl border bg-card p-6 text-card-foreground shadow-sm"
          >
            {Icon ? (
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
            ) : null}
            <h3 className="text-lg font-semibold tracking-tight">
              {feature.title}
            </h3>
            <p className="text-sm text-pretty text-muted-foreground">
              {feature.description}
            </p>
          </div>
        )
      })}
    </section>
  )
}
