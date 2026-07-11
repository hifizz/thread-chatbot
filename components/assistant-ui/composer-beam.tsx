"use client"

import { useEffect, useState, type FC, type ReactNode } from "react"
import { BorderBeam } from "border-beam"
import { useTheme } from "next-themes"

/**
 * 用 border-beam 的 pulse-inner 呼吸光晕包裹 composer 外壳，
 * 复刻 https://beam.jakubantalik.com/pulse 的光影效果：
 * 彩色光晕贴着输入框内侧四周弥散、缓慢呼吸（裁剪在边框以内），
 * 而非仅沿边框流动的一条光线。
 * 圆角由组件自动探测子元素的 border-radius（--composer-radius）。
 */
export const ComposerBeam: FC<{ children: ReactNode }> = ({ children }) => {
  const { resolvedTheme } = useTheme()

  // SSR 时 resolvedTheme 为 undefined，客户端首帧可能已解析出 light，
  // 直接使用会导致 BorderBeam 内联 <style> 的 hydration 不匹配。
  // 挂载后再切换到真实主题，服务端与客户端首帧统一按 dark 渲染。
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // wrapper 自带 overflow:hidden 会裁掉外壳的投影，
  // 所以把浅色模式的投影从外壳复制到 wrapper 上。
  return (
    <BorderBeam
      size="pulse-inner"
      colorVariant="colorful"
      theme={mounted && resolvedTheme === "light" ? "light" : "dark"}
      className="w-full rounded-(--composer-radius) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-shadow focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
    >
      {children}
    </BorderBeam>
  )
}
