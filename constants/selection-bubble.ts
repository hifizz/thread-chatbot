/**
 * constants/selection-bubble —— 划选气泡的几何参数。
 *
 * 定位走 floating-popup 模型（app/thread-chat/branching/bubble-position.ts），
 * 外轮廓与尾巴走 smooth-tooltip 模型（app/thread-chat/branching/bubble-shape.tsx）。
 * 这里集中气泡宽度、尾巴形状与安全边距，避免散落在组件里。
 */

import type { TailGeo } from "@/app/thread-chat/branching/bubble-shape"

/** 气泡面板宽度（固定），对应 smooth-tooltip 的 W */
export const BUBBLE_W = 260

/** 尾巴 + 面板圆角几何（用户实测调参）：aw/ah 尾巴半宽与高、flare 根部外扩、tip 顶点圆角、R 面板圆角 */
export const BUBBLE_TAIL: TailGeo = {
  aw: 8,
  ah: 8,
  flare: 6,
  tip: 1.5,
  R: 8,
}

/** 面板与选区之间的呼吸空间：略大于尾高 ah，顶点落在离选区约 2px 处 */
export const BUBBLE_GAP = BUBBLE_TAIL.ah + 2

/** 气泡与 viewport 四边的安全边距（同 floating-popup 默认） */
export const BUBBLE_SAFE_PADDING = 12

/** 尾巴横向落点 cx 的夹取余量：根部外扩 + 半宽 + 面板圆角，保证尾巴不爬上圆角 */
export const BUBBLE_TAIL_MARGIN =
  BUBBLE_TAIL.R + BUBBLE_TAIL.aw + BUBBLE_TAIL.flare
