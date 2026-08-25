/**
 * 可持久化文本锚点的领域类型。
 *
 * 这里只描述与 DOM 无关的数据契约；Range 定位和高亮绘制仍由客户端 branching
 * 适配层负责。
 */

/** 文本引用选择器（W3C Web Annotation TextQuoteSelector 简化版）。 */
export interface TextQuoteSelector {
  /** 被选中的确切文本。 */
  exact: string
  /** 选区左侧的上下文（用于多处命中时消歧）。 */
  prefix: string
  /** 选区右侧的上下文。 */
  suffix: string
}

/** 字符偏移选择器（快路径，页面结构没变时一击命中）。 */
export interface TextPositionSelector {
  start: number
  end: number
}

/** 一个可持久化的锚点：quote 是稳态线索，position 是加速线索。 */
export interface TextAnchor {
  quote: TextQuoteSelector
  position?: TextPositionSelector
}

export type LocateStrategy = "position" | "exact" | "fuzzy"

export interface LocateResult {
  start: number
  end: number
  /** 命中所用的策略，供 UI 标注与调试。 */
  strategy: LocateStrategy
  /** 命中置信度 0–1；position / exact 恒为 1，fuzzy 为相似度。 */
  score: number
}

export interface LocateOptions {
  /** fuzzy 命中的最低相似度，低于此值视为丢失。默认 0.7。 */
  fuzzyThreshold?: number
}
