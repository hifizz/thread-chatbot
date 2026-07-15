"use client"
/**
 * branching/bubble-shape —— 划选气泡的「平滑曲线」外轮廓（面板 + 指向选区的小尾巴，一条 path）。
 *
 * 移植自 playground.zilin.im 的 smooth-tooltip（`app/smooth-tooltip/page.tsx`）：
 *   整条轮廓用一条闭合 path 画成 —— 面板四角圆角(Q) · 尾巴根部凹角外扩(C) · 直斜边(L) ·
 *   顶点圆角(A)，单 fill 无拼接缝，取代过去那个 CSS 旋转小方块。
 *
 * 与 tooltip 的差异：tooltip 只朝下；气泡要么在选区下方（尾巴朝上 dir="up"），
 * 要么在上方（尾巴朝下 dir="down"）。canonical path 按「尾巴朝下」构造，dir="up" 时
 * 整条 path 竖直翻转即可（面板落到下半、尾巴翻到上半）。尾巴横向落点 cx 由上层按
 * 选区中心传入（不再永远居中），这样气泡贴边滑动后尾巴仍指着选区。
 */

import React, { useId } from "react"

export type TailDir = "up" | "down"

/** 尾巴几何：aw 半宽 · ah 高 · flare 根部外扩量(凹) · tip 顶点圆角(凸) · R 面板圆角 */
export interface TailGeo {
  aw: number
  ah: number
  flare: number
  tip: number
  R: number
}

interface PathGeo extends TailGeo {
  W: number
  H: number
  cx: number
}

/**
 * canonical 轮廓：面板左上角 (0,0)，宽 W、高 H，尾巴朝下、顶点在 (cx, H+ah)。
 * 三段曲线：① 凹·外扩 C（底边水平切线 → 斜边方向切线）② 直斜边 L ③ 凸·圆角 A。
 */
export function buildBubblePath({
  W,
  H,
  R,
  cx,
  aw,
  ah,
  flare,
  tip,
}: PathGeo): string {
  const len = Math.hypot(aw, ah) || 1
  // 右侧斜边「下行」单位向量（由根部指向顶点，即向下偏左）
  const dlx = -aw / len
  const dly = ah / len

  // 顶点圆角：沿斜边从顶点回退的切线长 d = tip / tan(θ) = tip·ah/aw
  const d = Math.min((tip * ah) / Math.max(aw, 1e-4), len * 0.6)
  // 外扩段沿斜边占用的长度（夹住，别和顶点圆角打架）
  const fs = Math.max(0, Math.min(flare, len - d - 2))

  const apexY = H + ah
  // 顶点圆弧的两个切点（分别在左右斜边上）
  const Trx = cx + (aw / len) * d,
    Try = apexY - (ah / len) * d
  const Tlx = cx - (aw / len) * d,
    Tly = Try
  // 外扩曲线与斜边的衔接点（根部往斜边下移 fs）
  const Srx = cx + aw + dlx * fs,
    Sry = H + dly * fs
  const Slx = cx - aw - dlx * fs,
    Sly = Sry
  // 外扩曲线在底边上的起点（凹角向外铺开 flare 的宽度）
  const Erx = cx + aw + flare,
    Elx = cx - aw - flare

  // 控制柄长度
  const c1 = flare * 0.55 // 底边端，水平
  const c2 = fs * 0.55 // 斜边端，沿斜边

  const f = (n: number) => Number(n.toFixed(2))
  const p = (a: number, b: number) => `${f(a)} ${f(b)}`

  return [
    `M ${p(R, 0)}`,
    `L ${p(W - R, 0)}`,
    `Q ${p(W, 0)} ${p(W, R)}`, // 右上角
    `L ${p(W, H - R)}`,
    `Q ${p(W, H)} ${p(W - R, H)}`, // 右下角
    `L ${p(Erx, H)}`, // 底边·右段
    // ① 右侧外扩：水平切线 → 斜边切线
    `C ${p(Erx - c1, H)} ${p(Srx - dlx * c2, Sry - dly * c2)} ${p(Srx, Sry)}`,
    `L ${p(Trx, Try)}`, // ② 右直斜边
    `A ${f(tip)} ${f(tip)} 0 0 1 ${p(Tlx, Tly)}`, // ③ 顶点圆弧(凸)
    `L ${p(Slx, Sly)}`, // ② 左直斜边
    // ① 左侧外扩：斜边切线 → 水平切线
    `C ${p(Slx + dlx * c2, Sly - dly * c2)} ${p(Elx + c1, H)} ${p(Elx, H)}`,
    `L ${p(R, H)}`, // 底边·左段
    `Q ${p(0, H)} ${p(0, H - R)}`, // 左下角
    `L ${p(0, R)}`,
    `Q ${p(0, 0)} ${p(R, 0)}`, // 左上角
    "Z",
  ].join(" ")
}

/**
 * 纯形状（svg 背景层）。面板宽 W、高 H，尾巴另占 ah 高。
 * dir="down"：面板在上、尾巴朝下（顶点 y=H+ah）；
 * dir="up"  ：整条 path 竖直翻转，面板落到下半、尾巴翻到上半（顶点 y=0）。
 * fill 默认 var(--ink)，与气泡深底一致；shadow 用 feDropShadow 复刻原气泡阴影。
 */
export function BubbleShape({
  W,
  H,
  cx,
  geo,
  dir,
  fill = "var(--ink)",
  shadow = true,
}: {
  W: number
  H: number
  cx: number
  geo: TailGeo
  dir: TailDir
  fill?: string
  shadow?: boolean
}) {
  const id = useId().replace(/:/g, "")
  const totalH = H + geo.ah
  const dStr = buildBubblePath({ W, H, cx, ...geo })
  // dir="up"：竖直翻转（面板到下半、尾巴到上半）
  const flip = dir === "up" ? `matrix(1 0 0 -1 0 ${totalH})` : undefined

  return (
    <svg
      width={W}
      height={totalH}
      viewBox={`0 0 ${W} ${totalH}`}
      style={{ display: "block", overflow: "visible" }}
    >
      {shadow && (
        <defs>
          <filter id={`sb-${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="8" floodOpacity="0.32" />
          </filter>
        </defs>
      )}
      <path
        d={dStr}
        transform={flip}
        style={{ fill }}
        filter={shadow ? `url(#sb-${id})` : undefined}
      />
    </svg>
  )
}
