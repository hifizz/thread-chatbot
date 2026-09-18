import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { ATTACHMENT_URL_PREFIX } from "@/constants/attachment"

/**
 * 分享正文的地址清洗：仅放行外部 http(s) 与页内锚点；
 * 私有附件路由、对象存储/签名地址、内部路径和危险协议一律移除。
 * 用 remark AST 定位 URL 节点后做字符串级替换——不经过 stringify，
 * 除被移除的节点外正文逐字节保留。
 */

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

export const SHARE_LINK_PLACEHOLDER = "[链接已隐藏]"

const PRIVATE_URL_MARKERS = [
  ATTACHMENT_URL_PREFIX,
  "r2.cloudflarestorage.com",
  "X-Amz-Signature",
  "X-Amz-Credential",
] as const

export function isSafeShareUrl(raw: string): boolean {
  const url = raw.trim()
  if (!url) return false
  if (url.startsWith("#")) return true
  if (!/^https?:\/\//i.test(url)) return false
  if (PRIVATE_URL_MARKERS.some((marker) => url.includes(marker))) return false
  return true
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 纯文本场景（quote/reasoning/html 等）的私有地址兜底。 */
const PRIVATE_TEXT_PATTERN = new RegExp(
  [
    String.raw`(?:https?://\S*)?${escapeRegExp(ATTACHMENT_URL_PREFIX)}\S*`,
    String.raw`https?://\S*r2\.cloudflarestorage\.com\S*`,
    String.raw`https?://\S*X-Amz-(?:Signature|Credential)\S*`,
  ].join("|"),
  "gi"
)

export function sanitizeShareText(text: string): string {
  return text.replace(PRIVATE_TEXT_PATTERN, SHARE_LINK_PLACEHOLDER)
}

type MdNode = {
  type: string
  value?: string
  url?: string
  alt?: string | null
  children?: MdNode[]
  position?: { start: { offset: number }; end: { offset: number } }
}

type Edit = { start: number; end: number; text: string }

function inlineText(node: MdNode): string {
  if (typeof node.value === "string") return node.value
  return (node.children ?? []).map(inlineText).join("")
}

function collectEdits(node: MdNode, edits: Edit[]): void {
  for (const child of node.children ?? []) {
    const position = child.position
    if (!position) {
      collectEdits(child, edits)
      continue
    }
    if (child.type === "link" && !isSafeShareUrl(child.url ?? "")) {
      // 链接不安全：去掉链接本身，保留可读文本
      edits.push({
        start: position.start.offset,
        end: position.end.offset,
        text: sanitizeShareText(inlineText(child)),
      })
      continue
    }
    if (child.type === "image" && !isSafeShareUrl(child.url ?? "")) {
      edits.push({
        start: position.start.offset,
        end: position.end.offset,
        text: child.alt?.trim() ? `*${child.alt.trim()}*` : "",
      })
      continue
    }
    if (child.type === "definition" && !isSafeShareUrl(child.url ?? "")) {
      edits.push({ start: position.start.offset, end: position.end.offset, text: "" })
      continue
    }
    if (
      (child.type === "text" || child.type === "html") &&
      typeof child.value === "string"
    ) {
      const sanitized = sanitizeShareText(child.value)
      if (sanitized !== child.value)
        edits.push({
          start: position.start.offset,
          end: position.end.offset,
          text: sanitized,
        })
      continue
    }
    collectEdits(child, edits)
  }
}

export function sanitizeShareMarkdown(markdown: string): string {
  const root = markdownParser.parse(markdown) as MdNode
  const edits: Edit[] = []
  collectEdits(root, edits)
  edits.sort((left, right) => right.start - left.start)
  let output = markdown
  for (const edit of edits)
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  return output
}
