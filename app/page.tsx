import type { Metadata } from "next"
import type { ReactElement } from "react"

import { Hero } from "@/components/landing/hero"
import { BranchingDemo } from "@/components/landing/branching-demo"
import { CanvasShowcase } from "@/components/landing/canvas-showcase"
import { FeatureGrid } from "@/components/landing/feature-grid"
import { ClosingCta } from "@/components/landing/closing-cta"

// 落地页专属 metadata（突出「分支对话」差异化）。
export const metadata: Metadata = {
  title: "Thread Chat · 让对话像思路一样分叉",
  description:
    "划选 AI 回复里的任意一句就地岔出新对话，整棵分支对话在画布上铺开——不再把追问挤进一根越拉越长的线里。",
}

/**
 * 公开落地页——server component，不读 session（保持静态可缓存）。
 * 按序组合各分区，套一个居中、限宽、纵向留白的响应式容器。
 */
export default function LandingPage(): ReactElement {
  return (
    <main className="w-full">
      {/* Hero 满屏全宽（自带动态背景），其余分区在限宽容器内 */}
      <Hero />
      <div className="mx-auto w-full max-w-5xl px-6 sm:px-8">
        <BranchingDemo />
        <CanvasShowcase />
        <FeatureGrid />
        <ClosingCta />
      </div>
    </main>
  )
}
