import { COMPOSER_TOUCH_MEDIA_QUERY } from "@/constants/composer"

export function shouldSubmitComposerKey(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}) {
  return (
    input.key === "Enter" &&
    !input.shiftKey &&
    !input.isComposing &&
    input.keyCode !== 229 &&
    // 在按键时读取，不依赖渲染时的屏宽或 hydration 状态。
    // 返回 false 后保留浏览器 / Lexical 原生换行，不拦截 beforeinput。
    !(typeof window !== "undefined" && window.matchMedia(COMPOSER_TOUCH_MEDIA_QUERY).matches)
  )
}
