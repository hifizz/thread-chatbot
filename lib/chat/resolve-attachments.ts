import type { UIMessage } from "ai"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import {
  ATTACHMENT_CONTEXT_CHAR_BUDGET,
  ATTACHMENT_URL_PREFIX,
} from "@/constants/attachment"
import { isEmbeddingsConfigured } from "@/constants/rag"
import { hasChunks, retrieveChunks } from "@/lib/chat/retrieve"

// 在 convertToModelMessages 之前，把 file part 转成模型可消费的稳定文本。
// Prompt Cache 的稳定历史必须禁止使用“当前问题驱动的 RAG”，否则同一历史会在
// 不同轮次得到不同正文。只有 Current User 动态尾部可以显式 allowRetrieval。

type FilePart = {
  type: "file"
  url: string
  mediaType: string
  filename?: string
}
type TextPart = { type: "text"; text: string }
type AttachmentRow = typeof attachments.$inferSelect

export type ResolveAttachmentOptions = {
  /** 当前用户动态尾部可开启；冻结历史和 Branch History 必须为 false。 */
  allowRetrieval?: boolean
  /** 可选显式 query；缺省时从传入 messages 的最后一条 user 文本派生。 */
  query?: string
}

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

function citeHint(attachmentId: string): string {
  return (
    `\n\n【引用要求】回答中凡是引用了本文档的内容，都要在句末用如下格式标注来源页码，` +
    `方便用户核对原文：[第N页](/api/attachments/${attachmentId}#page=N)（N 换成真实页码）。`
  )
}

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

function renderPdfRetrieved(
  row: AttachmentRow,
  excerpts: { page: number; content: string }[]
): TextPart {
  const body = excerpts
    .map((excerpt) => `[第 ${excerpt.page} 页]\n${excerpt.content}`)
    .join("\n\n")
  return {
    type: "text",
    text:
      `<attachment name="${row.filename}" pages="${row.pageCount ?? "?"}" mode="检索片段">\n` +
      `（以下是从文档中检索到的、与用户问题最相关的片段，非全文）\n\n${body}${citeHint(row.id)}\n</attachment>`,
  }
}

function latestUserQuery(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue
    const text = messages[i].parts
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim()
    if (text) return text
  }
  return ""
}

export async function resolveAttachmentParts(
  messages: UIMessage[],
  userId: string,
  options: ResolveAttachmentOptions = {}
): Promise<UIMessage[]> {
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
        .where(
          and(eq(attachments.userId, userId), inArray(attachments.id, [...ids]))
        )
    : []
  const rowById = new Map(rows.map((row) => [row.id, row]))

  const readyPdfCount = rows.filter(
    (row) =>
      row.mimeType === "application/pdf" &&
      row.status === "ready" &&
      row.pages?.length
  ).length
  const perPdfBudget = readyPdfCount
    ? Math.floor(ATTACHMENT_CONTEXT_CHAR_BUDGET / readyPdfCount)
    : 0
  const query = options.allowRetrieval
    ? (options.query?.trim() ?? latestUserQuery(messages))
    : ""

  const resolveFilePart = async (
    part: FilePart
  ): Promise<FilePart | TextPart> => {
    const id = attachmentIdFromUrl(part.url)
    const row = id ? rowById.get(id) : undefined

    if (part.mediaType === "application/pdf") {
      if (row?.status === "ready" && row.pages?.length) {
        const fullLength = row.pages.reduce((count, page) => count + page.length, 0)
        if (
          options.allowRetrieval &&
          fullLength > perPdfBudget &&
          query &&
          isEmbeddingsConfigured()
        ) {
          try {
            if (await hasChunks(row.id)) {
              const excerpts = await retrieveChunks(row.id, query)
              if (excerpts.length > 0) return renderPdfRetrieved(row, excerpts)
            }
          } catch {
            // 检索失败回退到确定性的全文截断。
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
