import type { ReactElement } from "react"

import { cn } from "@/lib/utils"
import { LANDING } from "@/constants/landing"

/** 分区组件通用 props：内容自 LANDING 取，仅暴露 className 供排版微调。 */
export interface SectionProps {
  className?: string
}

/**
 * 把 sampleAnswer 按 anchorText 拆成三段，中间段用高亮样式包起来，
 * 示意「划选的片段」。anchorText 恒为 sampleAnswer 子串（见 constants/landing.ts）。
 */
function renderHighlighted(sampleAnswer: string, anchorText: string) {
  const index = sampleAnswer.indexOf(anchorText)
  if (index === -1) return sampleAnswer // 兜底：拿不到子串就原样渲染
  const before = sampleAnswer.slice(0, index)
  const after = sampleAnswer.slice(index + anchorText.length)
  return (
    <>
      {before}
      <mark className="rounded bg-primary/15 px-0.5 text-foreground underline decoration-primary/60 decoration-2 underline-offset-4">
        {anchorText}
      </mark>
      {after}
    </>
  )
}

/** 「划选即开分支」的纯静态示意：高亮片段 + 从中岔出的子问题气泡。 */
export function BranchingDemo({ className }: SectionProps): ReactElement {
  const { title, description, sampleAnswer, anchorText, branchQuestion } =
    LANDING.branchingDemo

  return (
    <section className={cn("flex flex-col gap-8 py-16", className)}>
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {/* 主线里的样例 AI 回复，中间高亮被「划选」的片段 */}
        <div className="rounded-2xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
          <p className="text-sm leading-relaxed sm:text-base">
            {renderHighlighted(sampleAnswer, anchorText)}
          </p>
        </div>

        {/* 由高亮片段岔出的子问题气泡（示意，不接任何请求） */}
        <div className="flex items-start gap-3 sm:ps-10">
          <span
            aria-hidden
            className="mt-2 h-5 w-5 shrink-0 rounded-bl-2xl border-b border-l border-primary/40"
          />
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              岔出的子对话
            </span>
            <p className="text-sm text-foreground">{branchQuestion}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
