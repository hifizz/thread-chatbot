/**
 * theme —— 深度配色的小工具，chat 之上各层（branching / orchestration）共用。
 * 颜色本体定义在 styles/tokens/depth.css 的 --tc-depth-1..5（palette.css 持有 primitive 值），
 * 这里只做「深度 → CSS 变量」映射，且是全仓唯一的动态变量名拼接点。
 */

import type { Thread } from "./core/types"

/** 深度 → 1..5 的循环色号（fc-1..fc-5 类名用） */
export const dc = (depth: number) => ((depth - 1) % 5) + 1

/** 深度 → var(--tc-depth-N) 颜色表达式 */
export const dvar = (depth: number) => `var(--tc-depth-${dc(depth)})`

/** 列强调色：主线用 depth-1，其余按深度循环 */
export const accentOf = (t: Thread) =>
  t.depth === 0 ? "var(--tc-depth-1)" : dvar(t.depth)

/** 圆点 / 徽标色：主线用中性墨色，其余按深度循环 */
export const dotColorOf = (t: Thread) =>
  t.depth === 0 ? "var(--tc-depth-neutral)" : dvar(t.depth)
