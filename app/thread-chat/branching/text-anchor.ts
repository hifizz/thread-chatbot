/**
 * ============================================================================
 * text-anchor · 文本高亮的模糊恢复（单文件，零依赖，框架无关）
 * ============================================================================
 * 「保存一段网页高亮，等页面重渲染 / 空白重排 / 内容被编辑之后，还能把它找回来。」
 *
 * 核心思想：存的是**文本锚点**（引用文本 + 前后上下文 + 字符偏移），而不是 DOM
 * 路径 / XPath / nth-child —— 后者一旦页面结构变了就失效。恢复时三层降级：
 *
 *   1. position —— 直接用记录的偏移，校验该处文本仍等价于引用文本（最快，页面没变时命中）。
 *   2. exact    —— 全文精确搜索引用文本；多处命中时用 prefix/suffix 上下文 + 偏移就近消歧。
 *   3. fuzzy    —— 引用文本被改动到精确搜不到时，用「近似子串匹配」找最相似的一段，
 *                  给出相似度分数，低于阈值则判定丢失。
 *
 * 上半段（TextAnchor / locateOffsets / fuzzySubstring）是纯字符串逻辑，不碰 DOM，
 * 可直接单测、也可跑在 Node / Worker 里。下半段是 Range ↔ 偏移的 DOM 胶水与高亮绘制。
 *
 * 用法见文件末尾注释。锚点模型对齐 W3C Web Annotation 的 TextQuoteSelector +
 * TextPositionSelector，可与其它标注系统互通。
 * ============================================================================
 */

/* ========================================================================== */
/* 一、纯字符串层（DOM-free，可单测）                                            */
/* ========================================================================== */

/** 记录锚点时前后各截取多少字符作为上下文。 */
export const CONTEXT_WINDOW = 32

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

const DEFAULT_FUZZY_THRESHOLD = 0.7

/** 折叠所有空白为单空格并去除首尾（用于等价性比较）。 */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** 从一段文本快照 + 选区偏移构建 quote 选择器。 */
export function buildQuoteSelector(
  snapshot: string,
  start: number,
  end: number
): TextQuoteSelector {
  return {
    exact: snapshot.slice(start, end),
    prefix: snapshot.slice(Math.max(0, start - CONTEXT_WINDOW), start),
    suffix: snapshot.slice(end, end + CONTEXT_WINDOW),
  }
}

interface NormalizedText {
  norm: string
  starts: number[]
  ends: number[]
}

/**
 * 归一化空白并保留「归一化下标 → 原文下标」的双向映射。
 * fuzzy 匹配在归一化文本上做（对空白重排免疫），命中后再映射回原文偏移。
 */
function normalizeWithMap(raw: string): NormalizedText {
  const starts: number[] = []
  const ends: number[] = []
  let norm = ""
  let inWhitespace = false

  for (let i = 0; i < raw.length; i++) {
    const isWs = /\s/.test(raw[i])
    if (isWs) {
      if (!inWhitespace) {
        norm += " "
        starts.push(i)
        ends.push(i + 1)
        inWhitespace = true
      } else {
        ends[ends.length - 1] = i + 1
      }
    } else {
      norm += raw[i]
      starts.push(i)
      ends.push(i + 1)
      inWhitespace = false
    }
  }

  return { norm, starts, ends }
}

export interface FuzzyMatch {
  /** 归一化坐标下的匹配区间 [start, end)。 */
  start: number
  end: number
  /** 该匹配相对 pattern 的编辑距离。 */
  distance: number
}

/**
 * 在 text 中找出与 pattern 最相似的一段子串（近似子串匹配）。
 *
 * 用带「首尾自由 gap」的编辑距离 DP 实现：文本开头/结尾的字符可以任意跳过而不计代价，
 * 于是问题变成「pattern 对齐到 text 某个子串的最小编辑距离」。同时容忍替换 / 插入 /
 * 删除，所以对错字、增删词都稳。复杂度 O(n·m)，只在 exact 失败时兜底跑一次。
 *
 * @param hint 归一化坐标下的期望位置，用于在多个等距候选间就近消歧（可选）。
 */
export function fuzzySubstring(
  text: string,
  pattern: string,
  hint?: number
): FuzzyMatch | null {
  const m = pattern.length
  const n = text.length
  if (m === 0 || n === 0) return null

  let prevDist = new Array<number>(n + 1)
  let prevFrom = new Array<number>(n + 1)
  let currDist = new Array<number>(n + 1)
  let currFrom = new Array<number>(n + 1)

  // i = 0：空 pattern，任意起点免费，结束列即起始列。
  for (let j = 0; j <= n; j++) {
    prevDist[j] = 0
    prevFrom[j] = j
  }

  for (let i = 1; i <= m; i++) {
    currDist[0] = i
    currFrom[0] = 0
    const patChar = pattern[i - 1]

    for (let j = 1; j <= n; j++) {
      const subCost = prevDist[j - 1] + (patChar === text[j - 1] ? 0 : 1) // 对角：替换/相等
      const skipTextCost = currDist[j - 1] + 1 // 左：跳过一个 text 字符
      const dropPatCost = prevDist[j] + 1 // 上：pattern 字符没匹配上（删除）

      let best = subCost
      let from = prevFrom[j - 1]
      if (skipTextCost < best) {
        best = skipTextCost
        from = currFrom[j - 1]
      }
      if (dropPatCost < best) {
        best = dropPatCost
        from = prevFrom[j]
      }

      currDist[j] = best
      currFrom[j] = from
    }

    ;[prevDist, currDist] = [currDist, prevDist]
    ;[prevFrom, currFrom] = [currFrom, prevFrom]
  }

  let bestJ = -1
  let bestDist = Infinity
  for (let j = 1; j <= n; j++) {
    const d = prevDist[j]
    if (d > bestDist) continue
    if (d < bestDist) {
      bestDist = d
      bestJ = j
      continue
    }
    if (hint != null && bestJ !== -1) {
      if (Math.abs(prevFrom[j] - hint) < Math.abs(prevFrom[bestJ] - hint))
        bestJ = j
    }
  }

  if (bestJ === -1) return null
  const start = prevFrom[bestJ]
  const end = bestJ
  if (end <= start) return null
  return { start, end, distance: bestDist }
}

function findExactOffsets(
  text: string,
  quote: TextQuoteSelector,
  hint?: number
): { start: number; end: number } | null {
  if (!quote.exact) return null

  const matches: number[] = []
  let index = text.indexOf(quote.exact)
  while (index !== -1) {
    matches.push(index)
    index = text.indexOf(quote.exact, index + 1)
  }
  if (matches.length === 0) return null
  if (matches.length === 1) {
    return { start: matches[0], end: matches[0] + quote.exact.length }
  }

  // 多处命中：按「上下文吻合度 + 偏移就近」打分选最优
  let bestStart = matches[0]
  let bestScore = -Infinity
  for (const start of matches) {
    const prefixCandidate = text.slice(
      Math.max(0, start - quote.prefix.length),
      start
    )
    const suffixCandidate = text.slice(
      start + quote.exact.length,
      start + quote.exact.length + quote.suffix.length
    )
    let score = 0
    if (quote.prefix && prefixCandidate.endsWith(quote.prefix)) score += 2
    if (quote.suffix && suffixCandidate.startsWith(quote.suffix)) score += 2
    if (hint != null) score -= Math.abs(start - hint) / Math.max(1, text.length)
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }
  return { start: bestStart, end: bestStart + quote.exact.length }
}

/**
 * 在 text 中定位 anchor，返回偏移区间与所用策略；找不到返回 null。
 * 三层降级：position → exact → fuzzy。纯字符串逻辑，无 DOM 依赖。
 */
export function locateOffsets(
  text: string,
  anchor: TextAnchor,
  options: LocateOptions = {}
): LocateResult | null {
  const { quote, position } = anchor
  if (!quote?.exact) return null
  const threshold = options.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD
  const hint = position?.start

  // 1) position
  if (position) {
    const { start, end } = position
    if (start >= 0 && end > start && end <= text.length) {
      const slice = text.slice(start, end)
      if (normalizeWhitespace(slice) === normalizeWhitespace(quote.exact)) {
        return { start, end, strategy: "position", score: 1 }
      }
    }
  }

  // 2) exact
  const exact = findExactOffsets(text, quote, hint)
  if (exact) {
    return { start: exact.start, end: exact.end, strategy: "exact", score: 1 }
  }

  // 3) fuzzy（在归一化文本上做，再映射回原文偏移）
  const { norm, starts, ends } = normalizeWithMap(text)
  const normPattern = normalizeWhitespace(quote.exact)
  if (!normPattern) return null

  let normHint: number | undefined
  if (hint != null) {
    let lo = 0
    let hi = starts.length - 1
    normHint = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= hint) {
        normHint = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
  }

  const match = fuzzySubstring(norm, normPattern, normHint)
  if (!match) return null

  const score = 1 - match.distance / normPattern.length
  if (score < threshold) return null

  const rawStart = starts[match.start]
  const rawEnd = ends[match.end - 1]
  if (rawStart == null || rawEnd == null || rawEnd <= rawStart) return null

  return { start: rawStart, end: rawEnd, strategy: "fuzzy", score }
}

/* ========================================================================== */
/* 二、DOM 胶水层（Range ↔ 偏移 + 高亮绘制）                                     */
/* ========================================================================== */
/*
 * 坐标系约定：容器文本 = 容器内所有文本节点 .data 顺序拼接（等于 textContent，
 * 也等于 Range.selectNodeContents(root).toString()）。offset ↔ Range 两个方向
 * 都走这套坐标，保证一致。因此高亮跨内联元素 / 换行都不影响定位。
 */

export interface LocatedAnchor extends LocateResult {
  range: Range
}

/** 容器的文本坐标系：所有文本节点顺序拼接。 */
export function getRootText(root: Element): string {
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(root)
  return range.toString()
}

/** 求 (node, offset) 相对容器起点的字符偏移。 */
function offsetFromPoint(root: Element, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

/** 把字符区间 [start, end) 还原成容器内的 Range。 */
export function rangeFromOffsets(
  root: Element,
  start: number,
  end: number
): Range | null {
  if (start < 0 || end <= start) return null

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  let current = walker.nextNode() as Text | null
  while (current) {
    const len = current.data.length
    if (!startNode && consumed + len >= start) {
      startNode = current
      startOffset = start - consumed
    }
    if (startNode && consumed + len >= end) {
      endNode = current
      endOffset = end - consumed
      break
    }
    consumed += len
    current = walker.nextNode() as Text | null
  }

  if (!startNode || !endNode) return null
  const range = root.ownerDocument.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/** 从一次真实选区生成锚点（quote 上下文 + position 偏移）。 */
export function describeRange(root: Element, range: Range): TextAnchor | null {
  const raw = range.toString()
  if (raw.trim().length < 1) return null

  const snapshot = getRootText(root)
  const start = offsetFromPoint(root, range.startContainer, range.startOffset)
  const end = offsetFromPoint(root, range.endContainer, range.endOffset)
  if (end <= start) return null

  return {
    quote: buildQuoteSelector(snapshot, start, end),
    position: { start, end },
  }
}

/** 在容器里重新定位锚点，返回带 Range 的结果；找不到返回 null。 */
export function locateAnchor(
  root: Element,
  anchor: TextAnchor,
  options?: LocateOptions
): LocatedAnchor | null {
  const text = getRootText(root)
  const result = locateOffsets(text, anchor, options)
  if (!result) return null
  const range = rangeFromOffsets(root, result.start, result.end)
  if (!range) return null
  return { ...result, range }
}

/* --- 高亮绘制（<span> 包裹，可无损移除） ---------------------------------- */

const MARK_ATTR = "data-text-anchor-mark"

function collectTextNodes(range: Range): Text[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
  if (!root) return []

  const nodes: Text[] = []
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        range.intersectsNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    }
  )
  let current = walker.nextNode() as Text | null
  while (current) {
    nodes.push(current)
    current = walker.nextNode() as Text | null
  }
  return nodes
}

/**
 * Markdown 在块级结构之间会产生只含换行/缩进的 Text 节点。
 *
 * 它们不属于用户实际选中的正文；若包成 inline span，会在非叶子结构中生成匿名
 * 布局盒，造成列表、表格、引用等 Markdown 块之间出现多余空白。仅凭文本内容判断，
 * 不依赖也不枚举具体标签。
 */
function isHighlightableTextNode(node: Text): boolean {
  return node.data.trim().length > 0
}

/**
 * 用 <span data-text-anchor-mark=id> 包裹 range 覆盖的文本，实现高亮。
 * 逐个文本节点切分包裹，跨行 / 跨内联元素都能贴合。返回是否绘制成功。
 */
export function paintRange(
  range: Range,
  id: string,
  color = "rgba(255, 214, 0, 0.4)"
): boolean {
  if (range.collapsed) return false
  const nodes = collectTextNodes(range)
  if (nodes.length === 0) return false

  let painted = false
  nodes.forEach((node) => {
    if (!isHighlightableTextNode(node)) return
    if (node.parentElement?.closest(`[${MARK_ATTR}]`)) return

    let start = 0
    let end = node.data.length
    if (node === range.startContainer) start = range.startOffset
    if (node === range.endContainer) end = range.endOffset
    if (start >= end) return

    let target = node
    if (start > 0 && start < target.length) {
      target = target.splitText(start)
      end -= start
    }
    if (end < target.length) target.splitText(end)

    const span = target.ownerDocument.createElement("span")
    span.setAttribute(MARK_ATTR, id)
    span.style.background = color
    span.style.borderRadius = "2px"
    span.style.color = "inherit"

    const parent = target.parentNode
    if (!parent) return
    parent.insertBefore(span, target)
    span.appendChild(target)
    painted = true
  })

  return painted
}

function unwrap(span: Element) {
  const parent = span.parentNode
  if (!parent) return
  while (span.firstChild) parent.insertBefore(span.firstChild, span)
  parent.removeChild(span)
  parent.normalize?.()
}

/** 移除指定 id（或全部）高亮，还原 DOM。 */
export function clearHighlights(root: Element, id?: string): void {
  const selector = id
    ? `span[${MARK_ATTR}="${cssEscape(id)}"]`
    : `span[${MARK_ATTR}]`
  root.querySelectorAll(selector).forEach(unwrap)
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}

/* ========================================================================== */
/* 用法                                                                        */
/* ========================================================================== */
/*
 * // 1) 保存高亮：从用户选区生成锚点，持久化到 localStorage / 后端
 * const root = document.querySelector('#article')!            // 高亮的坐标系容器
 * const range = getSelection()!.getRangeAt(0)
 * const anchor = describeRange(root, range)                   // { quote, position }
 * if (anchor) save(id, anchor)                                // JSON.stringify 存起来
 *
 * // 2) 恢复高亮：页面（可能已漂移）加载后，把锚点找回来重新绘制
 * for (const { id, anchor } of load()) {
 *   const hit = locateAnchor(root, anchor)                    // 三层降级 position/exact/fuzzy
 *   if (hit) {
 *     paintRange(hit.range, id)
 *     console.log(id, hit.strategy, hit.score)                // 'fuzzy' 时 score < 1
 *   } else {
 *     console.warn(id, '内容改动过大，判定丢失')
 *   }
 * }
 *
 * // 3) 移除高亮
 * clearHighlights(root, id)     // 单条
 * clearHighlights(root)         // 全部
 *
 * 只要不碰 DOM，locateOffsets / fuzzySubstring 也能单独用于「给定纯文本 + 锚点，
 * 求偏移」的服务端 / Worker 场景。fuzzyThreshold 默认 0.7，按需要在 locateAnchor
 * 第三参调。
 */
