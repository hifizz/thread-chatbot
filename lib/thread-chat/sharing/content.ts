import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import { SHARE_ATTACHMENT, SHARE_LIMITS } from "@/constants/sharing"
import type { PublicMessage } from "./contracts"

type MarkdownNode = { type: string; url?: string; children?: MarkdownNode[]; position?: { start: { offset?: number }; end: { offset?: number } } }
const parser = unified().use(remarkParse).use(remarkGfm)

function decoded(value: string) {
  let result = value.replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_, hex, decimal) => {
    const point = parseInt(hex || decimal, hex ? 16 : 10)
    return point <= 0x10ffff ? String.fromCodePoint(point) : ""
  }).replace(/&(?:colon|sol|amp);/gi, (entity) => ({ "&colon;": ":", "&sol;": "/", "&amp;": "&" })[entity.toLowerCase()] || "")
  for (let count = 0; count < 3; count++) {
    try { const next = decodeURIComponent(result); if (next === result) break; result = next } catch { break }
  }
  return result.replace(/[\u0000-\u0020\u007f]/g, "").replace(/\\/g, "/")
}

/** 客户端也再次校验外链。私有资源从不转换成匿名附件权限。 */
export function safePublicHref(value: string): string | null {
  const clean = decoded(value)
  try {
    const url = new URL(clean)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null
    if (/\/(?:api|thread-chat|share)(?:\/|$)/i.test(url.pathname)) return null
    if (/(?:r2\.cloudflarestorage\.com|amazonaws\.com|blob\.core\.windows\.net)$/i.test(url.hostname)) return null
    if (/(?:^|[?&])(?:x-amz-[^=]*|x-goog-[^=]*|signature|sig|token|key-pair-id|awsaccesskeyid)=/i.test(url.search)) return null
    return url.href
  } catch { return null }
}

/** Markdown AST 覆盖引用式链接、自动链接、图片和 HTML；另清理代码/纯文本中的已知私有地址。 */
export function publicText(value: string): string {
  if (value.length > SHARE_LIMITS.text) throw new Error("SHARE_TOO_LARGE")
  const edits: Array<{ start: number; end: number; text: string }> = []
  function visit(node: MarkdownNode) {
    const blocked = node.type === "html" || node.type === "image" || node.type === "imageReference" ||
      ((node.type === "link" || node.type === "definition") && !safePublicHref(node.url || ""))
    if (blocked && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: node.type.startsWith("image") ? `[${SHARE_ATTACHMENT}]` : "[链接未分享]" })
    } else node.children?.forEach(visit)
  }
  visit(parser.parse(value) as MarkdownNode)
  let result = value
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  // 先解码候选地址再判断，不解码整份 Markdown，以保留代码和正文的原有格式。
  result = result.replace(/(?:https?(?::|%3a|&#(?:58|x3a);|&colon;)(?:\/|%2f|&#(?:47|x2f);|&sol;){2}|(?:\/|%2f){1,2}(?:api|thread-chat|share)(?:\/|%2f))[^\s<>"'`\])}]+/gi,
    (candidate) => safePublicHref(candidate) ? candidate : "[链接未分享]")
  result = result.replace(/[^\s<>"'`]+/g, (candidate) => {
    const normalized = decoded(candidate)
    return /\/(?:api|thread-chat|share)(?:\/|$)|(?:r2\.cloudflarestorage\.com|amazonaws\.com|blob\.core\.windows\.net)[/:?]|(?:javascript|vbscript|data|file|blob):/i.test(normalized)
      ? "[链接未分享]" : candidate
  })
  return result
}

export function publicParts(parts: unknown[], status: string): PublicMessage["parts"] {
  if (status === "generating") return []
  let characters = 0
  const clean = (value: string) => {
    characters += value.length
    if (characters > SHARE_LIMITS.snapshotBytes) throw new Error("SHARE_TOO_LARGE")
    return publicText(value)
  }
  return parts.flatMap((raw): PublicMessage["parts"] => {
    if (!raw || typeof raw !== "object") return []
    const part = raw as Record<string, unknown>
    if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") return [{ type: part.type, text: clean(part.text) }]
    if (part.type === "file") return [{ type: "attachment" }]
    if (part.type === "data-quote" && part.data && typeof part.data === "object" && "text" in part.data && typeof part.data.text === "string") return [{ type: "quote", text: clean(part.data.text) }]
    if (part.type === "source-url" && typeof part.url === "string") {
      const url = safePublicHref(part.url)
      return url ? [{ type: "source", url, title: clean(typeof part.title === "string" ? part.title : url) }] : []
    }
    return []
  })
}
