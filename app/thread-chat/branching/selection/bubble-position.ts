/**
 * branching/bubble-position —— 划选气泡的落点计算（纯几何、无 DOM 依赖）。
 *
 * 移植自 playground.zilin.im 的 floating-popup 定位模型（`app/floating-popup/position.ts`）：
 *   在 container（这里是浏览器 viewport）内，让 popup 围绕 anchor（选区包围盒）择位。
 *   按 sides 顺序逐个尝试，第一个能「干净放下」的方向即采用；主轴贴 anchor 留 gap，
 *   交叉轴对 anchor 居中、越界时沿交叉轴滑动（clamp 进安全区，不算失败）；
 *   popup 永不越出 container 内缩 safePadding 的安全区；四边都放不下时进入 fallback，
 *   取遮挡 anchor 面积最小的候选 —— 尽量不糊在用户刚选中的字上。
 *
 * 划选气泡只用上下两向（sides: ["bottom","top"]，见 selection-bubble.tsx），
 * 因为气泡的「平滑曲线小尾巴」是竖直指向的（bubble-shape.ts）。
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export type Side = "right" | "bottom" | "left" | "top"

export interface PositionOptions {
  /** popup 与 container 四边的最小安全边距，默认 12 */
  safePadding?: number
  /** popup 与 anchor 之间的呼吸空间，默认 4 */
  gap?: number
  /** 各方向的尝试顺序，默认 ["right", "bottom", "left", "top"] */
  sides?: Side[]
}

export interface PositionResult {
  /** popup 左上角坐标（与 container 同一坐标系） */
  left: number
  top: number
  /** 实际采用的方向 */
  side: Side
  /** true = 四边都放不下，当前是「遮挡最小」的兜底位置 */
  fallback: boolean
  /** popup 与 anchor 的重叠面积（px²），0 = 完全没有遮挡 */
  overlapArea: number
}

export interface SideCandidate {
  side: Side
  /** clamp 进安全区之后的位置 */
  left: number
  top: number
  /** 该方向能否「干净」放下（不出安全区、不遮挡 anchor） */
  fits: boolean
  overlapArea: number
}

const DEFAULT_SIDES: Side[] = ["right", "bottom", "left", "top"]

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min // 安全区都装不下 popup 时，贴 min（左/上）
  return Math.min(Math.max(value, min), max)
}

function intersectArea(
  left: number,
  top: number,
  size: Size,
  rect: Rect
): number {
  const w =
    Math.min(left + size.width, rect.left + rect.width) -
    Math.max(left, rect.left)
  const h =
    Math.min(top + size.height, rect.top + rect.height) -
    Math.max(top, rect.top)
  return Math.max(0, w) * Math.max(0, h)
}

/**
 * 带过程信息的版本：除最终结果外，返回各方向的候选位置与可行性，方便调试 / 可视化。
 * 日常使用直接调 computePopupPosition 即可。
 */
export function explainPopupPosition(
  anchor: Rect,
  popup: Size,
  container: Rect,
  options: PositionOptions = {}
): { result: PositionResult; candidates: SideCandidate[] } {
  const safePadding = options.safePadding ?? 12
  const gap = options.gap ?? 4
  const sides = options.sides ?? DEFAULT_SIDES

  // popup 左上角允许出现的范围（container 内缩 safePadding 的安全区）
  const minLeft = container.left + safePadding
  const minTop = container.top + safePadding
  const maxLeft = container.left + container.width - safePadding - popup.width
  const maxTop = container.top + container.height - safePadding - popup.height
  // popup 整体能否装进安全区（任何方向都以此为前提）
  const containable = maxLeft >= minLeft && maxTop >= minTop

  const anchorRight = anchor.left + anchor.width
  const anchorBottom = anchor.top + anchor.height
  // 交叉轴居中的理想位置
  const centeredLeft = anchor.left + anchor.width / 2 - popup.width / 2
  const centeredTop = anchor.top + anchor.height / 2 - popup.height / 2

  // 各方向候选：主轴贴 anchor + gap；交叉轴居中后 clamp 进安全区（允许滑动）
  const ideal: Record<Side, { left: number; top: number }> = {
    right: { left: anchorRight + gap, top: clamp(centeredTop, minTop, maxTop) },
    bottom: {
      left: clamp(centeredLeft, minLeft, maxLeft),
      top: anchorBottom + gap,
    },
    left: {
      left: anchor.left - gap - popup.width,
      top: clamp(centeredTop, minTop, maxTop),
    },
    top: {
      left: clamp(centeredLeft, minLeft, maxLeft),
      top: anchor.top - gap - popup.height,
    },
  }

  const candidates: SideCandidate[] = sides.map((side) => {
    const c = ideal[side]
    const fits =
      containable &&
      c.left >= minLeft &&
      c.left <= maxLeft &&
      c.top >= minTop &&
      c.top <= maxTop
    // 不可行的方向按 clamp 进安全区后的位置参与兜底比较
    const left = clamp(c.left, minLeft, maxLeft)
    const top = clamp(c.top, minTop, maxTop)
    return {
      side,
      left,
      top,
      fits,
      overlapArea: intersectArea(left, top, popup, anchor),
    }
  })

  // 1) 有干净放得下的方向 → 按顺序取第一个
  const clean = candidates.find((c) => c.fits)
  if (clean) {
    return {
      result: {
        left: clean.left,
        top: clean.top,
        side: clean.side,
        fallback: false,
        overlapArea: 0,
      },
      candidates,
    }
  }

  // 2) fallback：取遮挡 anchor 面积最小的候选（并列时尊重 sides 顺序）
  let best = candidates[0]
  for (const c of candidates) {
    if (c.overlapArea < best.overlapArea) best = c
  }
  return {
    result: {
      left: best.left,
      top: best.top,
      side: best.side,
      fallback: true,
      overlapArea: best.overlapArea,
    },
    candidates,
  }
}

/**
 * 计算 popup 围绕 anchor 在 container 内的落点。
 *
 * @param anchor    选区矩形（选区包围盒），与 container 同坐标系
 * @param popup     popup 的尺寸（气泡面板宽高）
 * @param container 限定范围，viewport 场景传 {left:0, top:0, width:innerWidth, height:innerHeight}
 */
export function computePopupPosition(
  anchor: Rect,
  popup: Size,
  container: Rect,
  options: PositionOptions = {}
): PositionResult {
  return explainPopupPosition(anchor, popup, container, options).result
}
