"use client"

import { useSyncExternalStore } from "react"
import {
  GrainGradient,
  grainGradientPresets,
  type GrainGradientProps,
} from "@paper-design/shaders-react"

import { cn } from "@/lib/utils"

// Paper Shaders 的 grain-gradient「Wave」预设（shaders.paper.design/grain-gradient）。
// 根导出的是预设数组，按名取 Wave；取不到则回退第一个，保证永不为空。
const WAVE_PRESET =
  grainGradientPresets.find((preset) => preset.name === "Wave") ??
  grainGradientPresets[0]

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * 订阅系统「减少动态效果」偏好——用 useSyncExternalStore 而非 effect+setState，
 * 既 SSR 安全（服务端快照返回 false）又不触发 react-hooks/set-state-in-effect。
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(REDUCED_MOTION_QUERY)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  )
}

export interface GrainGradientBackgroundProps {
  className?: string
}

/**
 * 落地页首屏的动态背景：铺满父容器的 grain-gradient「Wave」着色器。
 * 父容器需 `relative`，本组件绝对定位填满。WebGL 客户端渲染，服务端出占位 div。
 */
export function GrainGradientBackground({
  className,
}: GrainGradientBackgroundProps): React.ReactElement {
  const reducedMotion = usePrefersReducedMotion()
  // 预设参数是 GrainGradientParams；减少动态时把 speed 归零（静态定格），其余照搬。
  const params = WAVE_PRESET.params as GrainGradientProps

  return (
    <GrainGradient
      {...params}
      speed={reducedMotion ? 0 : params.speed}
      className={cn("h-full w-full", className)}
    />
  )
}
