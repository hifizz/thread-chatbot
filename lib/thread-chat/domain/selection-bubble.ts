/** 划选气泡相对选区的朝向。 */
export type TailDir = "up" | "down"

/** 尾巴几何：aw 半宽 · ah 高 · flare 根部外扩量 · tip 顶点圆角 · R 面板圆角。 */
export interface TailGeo {
  aw: number
  ah: number
  flare: number
  tip: number
  R: number
}
