"use client"

import { useSyncExternalStore, type FC, type ReactNode } from "react"
import { BorderBeam } from "border-beam"
import { useTheme } from "next-themes"

// 水合安全的挂载检测：服务端快照为 false，水合完成后 React 以客户端快照 true 重渲染。
const noopSubscribe = () => () => {}
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
}

/**
 * border-beam pulse-inner 呼吸光晕的通用包装，
 * 复刻 https://beam.jakubantalik.com/pulse 的光影效果：
 * 彩色光晕贴着元素内侧四周弥散、缓慢呼吸（裁剪在边框以内）。
 * 跟随 next-themes 的明暗主题；圆角默认自动探测子元素，
 * 子元素圆角探测不到时（如首子元素是无圆角的内部布局）可显式传 borderRadius。
 * active 控制光晕开关（带淡入/淡出过渡），用于绑定 AI 回复中等运行状态。
 * staticColors 冻结色相流转（呼吸仍在），strength 控制整体亮度（0-1），
 * 两者组合可实现「空闲微光、运行全彩流动」的混合状态。
 */
export const PulseBeam: FC<{
  children: ReactNode
  className?: string
  borderRadius?: number
  active?: boolean
  staticColors?: boolean
  strength?: number
}> = ({
  children,
  className,
  borderRadius,
  active = true,
  staticColors,
  strength,
}) => {
  const { resolvedTheme } = useTheme()

  // SSR 时 resolvedTheme 为 undefined，客户端首帧可能已解析出 light，
  // 直接使用会导致 BorderBeam 内联 <style> 的 hydration 不匹配。
  // 水合完成后再切换到真实主题，服务端与客户端首帧统一按 dark 渲染。
  const hydrated = useHydrated()

  return (
    <BorderBeam
      size="pulse-inner"
      colorVariant="colorful"
      theme={hydrated && resolvedTheme === "light" ? "light" : "dark"}
      borderRadius={borderRadius}
      active={active}
      staticColors={staticColors}
      strength={strength}
      className={className}
    >
      {children}
    </BorderBeam>
  )
}
