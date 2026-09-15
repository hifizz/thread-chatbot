import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
}

function visibleText(node: MarkdownNode): string {
  // 坐标系对齐 Range.toString()（纯文本节点拼接）：
  // - break：remark-rehype 在 <br> 后补一个 "\n" 文本节点，DOM 划选包含该换行。
  // - html：react-markdown 无 rehype-raw 时把 raw 节点渲染为源码文本（除非 skipHtml），
  //   node.value 与 DOM 可见字符一致，按普通文本计入。
  // - definition/image 没有可划选的 DOM 文字；math/footnoteReference 的渲染 DOM
  //   虽含可选字符但坐标不可复现：跳过会使其后内容的 position 快路径失效，
  //   由 exact+prefix/suffix 兜底；跨节点划选保守拒绝。
  if (node.type === "break") return "\n"
  if (
    ["definition", "image", "imageReference", "math", "inlineMath",
     "footnoteReference"].includes(node.type)
  ) return ""
  if (typeof node.value === "string") return node.value
  return node.children?.map(visibleText).join("") ?? ""
}

/** 与 MarkdownBody 使用同一套语法解析，保留代码、转义字符及解码后的实体。 */
export function markdownVisibleText(markdown: string): string {
  const root = markdownParser.parse(markdown)
  const main: string[] = []
  const footnotes: string[] = []
  for (const child of root.children ?? []) {
    // footnoteDefinition 的正文渲染在文档末尾的 footnotes 区块，按 DOM 顺序排到尾部；
    // 区块中的 "Footnotes" 标题与 "↩" 回链字符不模拟，跨该边界的划选保守拒绝。
    ;(child.type === "footnoteDefinition" ? footnotes : main).push(
      visibleText(child)
    )
  }
  return main.join("") + footnotes.join("")
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
  const uniqueStart = text.indexOf(exact)
  if (uniqueStart === -1) return null
  if (text.indexOf(exact, uniqueStart + 1) !== -1) return null
  return { start: uniqueStart, end: uniqueStart + exact.length }
}
