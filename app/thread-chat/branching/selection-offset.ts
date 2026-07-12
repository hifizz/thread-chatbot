/**
 * branching/selection-offset —— 把 DOM 选区换算成 assistant 消息源文本（msg.text）的精确偏移。
 *
 * assistant 正文的渲染规则（见 branchable-chat renderAssistantBody / chat-view withBreaks）：
 *   - 每个段落一个 <p>，段落间源文本为 "\n\n"；
 *   - 段内换行渲染成 <br/>，对应源文本 "\n"；
 *   - 锚点高亮 <span class="anchored"> 的文字属于源文本，原样累计；
 *   - 脚注上标 <sup> 的数字不属于源文本，整体跳过；
 *   - 流式光标 <span class="caret"> 等空元素自然贡献 0 字符。
 * 按此规则遍历气泡重建源文本，同时定位选区两端点，即得精确 offset——
 * 供 TextQuoteSelector 式采集（划选原文 + 前后上下文）使用。
 * 端点落在被跳过的节点里（如 sup）或不在气泡内时返回 null，调用方回退旧行为。
 */

export interface ResolvedSelection {
  /** 选区起点在源文本中的偏移 */
  start: number
  /** 选区终点在源文本中的偏移 */
  end: number
  /** 按渲染规则重建出的完整源文本（调用方可与 msg.text 比对做一致性校验） */
  rebuilt: string
}

/** 把选区 range 换算为 bubble 对应消息源文本的偏移；无法换算时返回 null */
export function resolveSelectionOffsets(
  bubble: HTMLElement,
  range: Range
): ResolvedSelection | null {
  let pos = 0
  let start = -1
  let end = -1
  let rebuilt = ""
  let pCount = 0

  /** 端点容器是元素节点时，边界落在「第 childIdx 个子节点之前」 */
  const markElementBoundary = (el: Node, childIdx: number) => {
    if (range.startContainer === el && range.startOffset === childIdx)
      start = pos
    if (range.endContainer === el && range.endOffset === childIdx) end = pos
  }

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? ""
      if (range.startContainer === node)
        start = pos + Math.min(range.startOffset, text.length)
      if (range.endContainer === node)
        end = pos + Math.min(range.endOffset, text.length)
      rebuilt += text
      pos += text.length
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.tagName === "SUP") return // 脚注数字不属于源文本：整体跳过（端点落在其中则换算失败）
    if (el.tagName === "BR") {
      rebuilt += "\n"
      pos += 1
      return
    }
    if (el.tagName === "P") {
      // 段落边界 = 源文本 "\n\n"（首个段落之前没有）
      if (pCount > 0) {
        rebuilt += "\n\n"
        pos += 2
      }
      pCount++
    }
    const children = el.childNodes
    for (let i = 0; i < children.length; i++) {
      markElementBoundary(el, i)
      visit(children[i])
    }
    markElementBoundary(el, children.length)
  }

  visit(bubble)

  if (start === -1 || end === -1) return null
  if (end < start) {
    const tmp = start
    start = end
    end = tmp
  }
  return { start, end, rebuilt }
}
