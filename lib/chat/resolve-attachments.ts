import type { UIMessage } from "ai"
import { inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import {
  ATTACHMENT_CONTEXT_CHAR_BUDGET,
  ATTACHMENT_URL_PREFIX,
} from "@/constants/attachment"
import { isEmbeddingsConfigured } from "@/constants/rag"
import { hasChunks, retrieveChunks } from "@/lib/chat/retrieve"

// MiniMax 的 OpenAI 兼容端点只接受 text/image_url/video_url，不接受任何 file content part；
// 且 @ai-sdk/openai-compatible 对「PDF file part + URL」直接抛 UnsupportedFunctionalityError。
// 因此在 convertToModelMessages 之前，把所有 file part 兜底转换为模型可消费的 text part：
//   - PDF（已解析入库）→ 注入正文
//       · 全文能装进预算 → 直接全文注入（带页码标记）
//       · 全文超预算 且 已建向量索引 → RAG：只注入与问题最相关的片段（带页码）
//       · 否则 → 全文按页截断注入（降级）
//   - 图片 → 占位说明（MiniMax-M2 无视觉能力；换视觉模型时改这一个分支即可）
//   - 其他类型 / 解析失败 / 查不到 → 附件元信息占位，绝不让附件打断对话

type FilePart = {
  type: "file"
  url: string
  mediaType: string
  filename?: string
}
type TextPart = { type: "text"; text: string }
type AttachmentRow = typeof attachments.$inferSelect

function isFilePart(part: { type: string }): part is FilePart {
  return part.type === "file"
}

function attachmentIdFromUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return null
  const id = url.slice(ATTACHMENT_URL_PREFIX.length)
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

function placeholder(part: FilePart, note: string): TextPart {
  const name = part.filename ?? "未命名文件"
  return {
    type: "text",
    text: `[用户上传了附件：${name}（${part.mediaType}）——${note}]`,
  }
}

/**
 * 引用要求：让模型引用文档内容时用可点击的 markdown 链接标注来源页码。
 * 用普通的相对路径（而非自定义协议 attachment://）——react-markdown 出于 XSS
 * 防护会清空非白名单协议（http/https/mailto 等）的 href，导致链接点击无效。
 */
function citeHint(attachmentId: string): string {
  return (
    `\n\n【引用要求】回答中凡是引用了本文档的内容，都要在句末用如下格式标注来源页码，` +
    `方便用户核对原文：[第N页](/api/attachments/${attachmentId}#page=N)（N 换成真实页码）。`
  )
}

/** 全文注入：按页拼接，超出 charBudget 时按页截断并显式告知模型 */
function renderPdfFull(row: AttachmentRow, charBudget: number): TextPart {
  const pages = row.pages ?? []
  const chunks: string[] = []
  let used = 0
  let includedPages = 0

  for (let i = 0; i < pages.length; i++) {
    const pageText = `[第 ${i + 1} 页]\n${pages[i]}`
    if (used + pageText.length > charBudget && includedPages > 0) break
    chunks.push(
      used + pageText.length > charBudget
        ? pageText.slice(0, charBudget - used)
        : pageText
    )
    used += pageText.length
    includedPages++
    if (used >= charBudget) break
  }

  const truncated = includedPages < pages.length
  const suffix = truncated
    ? `\n\n[已截断：全文共 ${pages.length} 页，以上仅包含前 ${includedPages} 页内容]`
    : ""
  return {
    type: "text",
    text: `<attachment name="${row.filename}" pages="${row.pageCount ?? pages.length}">\n${chunks.join("\n\n")}${suffix}${citeHint(row.id)}\n</attachment>`,
  }
}

/** RAG 注入：只放检索到的相关片段（带页码），大幅压缩超大文档的上下文占用 */
function renderPdfRetrieved(
  row: AttachmentRow,
  excerpts: { page: number; content: string }[]
): TextPart {
  const body = excerpts
    .map((e) => `[第 ${e.page} 页]\n${e.content}`)
    .join("\n\n")
  return {
    type: "text",
    text:
      `<attachment name="${row.filename}" pages="${row.pageCount ?? "?"}" mode="检索片段">\n` +
      `（以下是从文档中检索到的、与用户问题最相关的片段，非全文）\n\n${body}${citeHint(row.id)}\n</attachment>`,
  }
}

/** 取最后一条用户消息的文本作为检索 query */
function latestUserQuery(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue
    const text = messages[i].parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .trim()
    if (text) return text
  }
  return ""
}

export async function resolveAttachmentParts(
  messages: UIMessage[]
): Promise<UIMessage[]> {
  // 1) 收集本次请求引用的全部附件 id，一次批量查库
  const ids = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (isFilePart(part)) {
        const id = attachmentIdFromUrl(part.url)
        if (id) ids.add(id)
      }
    }
  }
  const rows = ids.size
    ? await db
        .select()
        .from(attachments)
        .where(inArray(attachments.id, [...ids]))
    : []
  const rowById = new Map(rows.map((row) => [row.id, row]))

  // 2) 字符预算在所有可注入的 PDF 之间平摊
  const readyPdfCount = rows.filter(
    (row) =>
      row.mimeType === "application/pdf" &&
      row.status === "ready" &&
      row.pages?.length
  ).length
  const perPdfBudget = readyPdfCount
    ? Math.floor(ATTACHMENT_CONTEXT_CHAR_BUDGET / readyPdfCount)
    : 0
  const query = latestUserQuery(messages)

  // 3) 逐 part 转换（含可能的向量检索，故为异步）
  const resolveFilePart = async (
    part: FilePart
  ): Promise<FilePart | TextPart> => {
    const id = attachmentIdFromUrl(part.url)
    const row = id ? rowById.get(id) : undefined

    if (part.mediaType === "application/pdf") {
      if (row?.status === "ready" && row.pages?.length) {
        const fullLength = row.pages.reduce((n, p) => n + p.length, 0)
        // 全文超预算 且 已建索引 且 有 query → 走 RAG，只注入相关片段
        if (fullLength > perPdfBudget && query && isEmbeddingsConfigured()) {
          try {
            if (await hasChunks(row.id)) {
              const excerpts = await retrieveChunks(row.id, query)
              if (excerpts.length > 0) return renderPdfRetrieved(row, excerpts)
            }
          } catch {
            // 检索失败回退到全文（截断）注入
          }
        }
        return renderPdfFull(row, perPdfBudget)
      }
      if (row?.status === "failed") {
        return placeholder(part, `解析失败：${row.error ?? "未知原因"}`)
      }
      return placeholder(part, "内容不可读取")
    }
    if (part.mediaType.startsWith("image/")) {
      return placeholder(part, "当前模型不支持查看图片，仅知晓其存在")
    }
    return placeholder(part, "该类型暂不支持内容解读")
  }

  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map((part) =>
          isFilePart(part) ? resolveFilePart(part) : Promise.resolve(part)
        )
      ),
    }))
  ) as Promise<UIMessage[]>
}
