import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

/**
 * Markdown Artifact 选区的服务端校验只关心用户可见文字，不使用源码下标。
 * 这里故意保持零依赖，并与当前 MarkdownBody 支持的常见 GFM 文字构造对齐。
 * Mermaid / KaTeX 等生成型 DOM 不在本规则内，由选区入口拒绝。
 */
export function markdownVisibleText(markdown: string): string {
  let value = markdown.replace(/\r\n?/g, "\n")

  // HTML 注释不渲染；普通标签只保留其文字内容。
  value = value.replace(/<!--[\s\S]*?-->/g, "")
  value = value.replace(/<[^>]+>/g, "")

  // 图片的 alt 与链接 label 是阅读区可见文字，URL/target 不可见。
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  value = value.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
  value = value.replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, "")

  // fenced code 保留代码正文但移除 fence 与 language；inline code 保留正文。
  value = value.replace(/^\s*(```+|~~~+)\s*[^\n]*$/gm, "")
  value = value.replace(/(`+)([^\n]*?)\1/g, "$2")

  // 块级 Markdown 标记本身不可见。
  value = value.replace(/^\s{0,3}#{1,6}[ \t]+/gm, "")
  value = value.replace(/[ \t]+#+[ \t]*$/gm, "")
  value = value.replace(/^\s{0,3}>[ \t]?/gm, "")
  value = value.replace(/^\s{0,3}(?:[-+*]|\d+[.)])[ \t]+/gm, "")
  value = value.replace(/^\s{0,3}\[[ xX]\][ \t]+/gm, "")
  value = value.replace(/^\s*[-:| ]+\|[-:| ]*$/gm, "")

  // GFM 表格分隔符不可见；单元格之间在 DOM textContent 中直接相邻。
  value = value.replace(/^\s*\|/gm, "")
  value = value.replace(/\|\s*$/gm, "")
  value = value.replace(/\s*\|\s*/g, "")

  // emphasis / strike 标记不可见。转义字符只显示被转义的字符。
  value = value.replace(/(\*\*|__|~~|\*|_)/g, "")
  value = value.replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, "$1")

  // React Markdown 的相邻 block 元素之间不会凭空产生可见分隔字符；保留段内
  // 单换行，但移除纯结构空行，避免源码排版影响锚点身份。
  value = value.replace(/\n[ \t]*\n+/g, "")
  return value
}

export interface ExactAnchorMatch {
  start: number
  end: number
}

function contextMatches(
  text: string,
  start: number,
  end: number,
  anchor: TextAnchor
): boolean {
  const { prefix, suffix } = anchor.quote
  return (
    (!prefix || text.slice(Math.max(0, start - prefix.length), start).endsWith(prefix)) &&
    (!suffix || text.slice(end, end + suffix.length).startsWith(suffix))
  )
}

/**
 * 严格定位 Artifact 锚点：position 只作快路径，随后 exact + prefix/suffix 消歧。
 * 不做 fuzzy；不能唯一证明来源时返回 null。
 */
export function locateArtifactAnchor(
  markdown: string,
  anchor: TextAnchor
): ExactAnchorMatch | null {
  const text = markdownVisibleText(markdown)
  const exact = anchor.quote.exact
  if (!exact) return null

  const position = anchor.position
  if (
    position &&
    position.end > position.start &&
    text.slice(position.start, position.end) === exact &&
    contextMatches(text, position.start, position.end, anchor)
  ) {
    return { start: position.start, end: position.end }
  }

  const candidates: ExactAnchorMatch[] = []
  let start = text.indexOf(exact)
  while (start !== -1) {
    const end = start + exact.length
    if (contextMatches(text, start, end, anchor)) candidates.push({ start, end })
    start = text.indexOf(exact, start + 1)
  }

  if (candidates.length === 1) return candidates[0]

  // 老浏览器或块级 DOM 的 prefix/suffix 可能与源码归一化的边界略有差异；
  // exact 本身若全篇唯一，仍可安全授权。重复 exact 则绝不猜第一处。
  let uniqueStart = text.indexOf(exact)
  if (uniqueStart === -1) return null
  if (text.indexOf(exact, uniqueStart + 1) !== -1) return null
  return { start: uniqueStart, end: uniqueStart + exact.length }
}
