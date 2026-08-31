import { and, eq, inArray } from "drizzle-orm"
import { ATTACHMENT_URL_PREFIX } from "@/constants/attachment"
import { isEmbeddingsConfigured } from "@/constants/rag"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import { hasChunks, retrieveChunks } from "@/lib/chat/retrieve"
import type { ProjectFileRow } from "@/lib/thread-chat/persistence/mappers"

export type AttachmentRow = typeof attachments.$inferSelect
export type AttachmentRenderMode = "full" | "retrieval" | "fallback"

export type AttachmentFilePart = {
  type: "file"
  url: string
  mediaType: string
  filename?: string
}

export type AttachmentTextPart = { type: "text"; text: string }

export function attachmentIdFromUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return null
  const id = url.slice(ATTACHMENT_URL_PREFIX.length)
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export async function loadOwnedAttachmentRows(
  userId: string,
  attachmentIds: readonly string[]
): Promise<Map<string, AttachmentRow>> {
  const ids = [...new Set(attachmentIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(eq(attachments.userId, userId), inArray(attachments.id, ids))
    )
  return new Map(rows.map((row) => [row.id, row]))
}

export function escapeAttachmentAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function citeHint(attachmentId: string): string {
  return (
    `\n\n【引用要求】回答中凡是引用了本文档的内容，都要在句末用如下格式标注来源页码，` +
    `方便用户核对原文：[第N页](/api/attachments/${attachmentId}#page=N)（N 换成真实页码）。`
  )
}

function renderPdfPages(row: AttachmentRow, charBudget: number): string {
  const pages = row.pages ?? []
  const chunks: string[] = []
  let used = 0
  let includedPages = 0
  for (let index = 0; index < pages.length; index += 1) {
    const pageText = `[第 ${index + 1} 页]\n${pages[index]}`
    if (used + pageText.length > charBudget && includedPages > 0) break
    chunks.push(
      used + pageText.length > charBudget
        ? pageText.slice(0, Math.max(0, charBudget - used))
        : pageText
    )
    used += pageText.length
    includedPages += 1
    if (used >= charBudget) break
  }
  const truncated = includedPages < pages.length
  return `${chunks.join("\n\n")}${
    truncated
      ? `\n\n[已截断：全文共 ${pages.length} 页，以上仅包含前 ${includedPages} 页内容]`
      : ""
  }`
}

export async function renderPdfAttachment(
  row: AttachmentRow,
  charBudget: number,
  query: string
): Promise<{ text: string; mode: AttachmentRenderMode }> {
  const pages = row.pages ?? []
  const fullLength = pages.reduce((sum, page) => sum + page.length, 0)
  if (fullLength > charBudget && query && isEmbeddingsConfigured()) {
    try {
      if (await hasChunks(row.id)) {
        const excerpts = await retrieveChunks(row.id, query)
        if (excerpts.length > 0) {
          const body = excerpts
            .map((excerpt) => `[第 ${excerpt.page} 页]\n${excerpt.content}`)
            .join("\n\n")
            .slice(0, charBudget)
          return {
            mode: "retrieval",
            text:
              `<attachment name="${escapeAttachmentAttribute(row.filename)}" pages="${row.pageCount ?? pages.length}" mode="检索片段">\n` +
              `（以下是与当前问题最相关的检索片段，非全文）\n\n${body}${citeHint(row.id)}\n</attachment>`,
          }
        }
      }
    } catch {
      // Embedding/chunk 检索不可用时，确定性降级到按页截断。
    }
  }
  const truncated = fullLength > charBudget
  return {
    mode: truncated ? "fallback" : "full",
    text:
      `<attachment name="${escapeAttachmentAttribute(row.filename)}" pages="${row.pageCount ?? pages.length}">\n` +
      `${renderPdfPages(row, charBudget)}${citeHint(row.id)}\n</attachment>`,
  }
}

export function attachmentPlaceholder(
  part: AttachmentFilePart,
  row?: AttachmentRow
): AttachmentTextPart {
  const name = part.filename ?? "未命名文件"
  let note: string
  if (part.mediaType === "application/pdf") {
    note =
      row?.status === "failed"
        ? `解析失败：${row.error ?? "未知原因"}`
        : row?.status === "uploading"
          ? "仍在上传或解析，正文尚不可用"
          : "内容不可读取"
  } else if (part.mediaType.startsWith("image/")) {
    note = "当前模型不支持查看图片，仅知晓其存在"
  } else {
    note = "该类型暂不支持内容解读"
  }
  return {
    type: "text",
    text: `[用户上传了附件：${name}（${part.mediaType}）——${note}]`,
  }
}

export function projectFileManifestLine(
  row: ProjectFileRow,
  explicit: boolean
): string {
  const attachment = row.attachment
  const contentState =
    attachment.status !== "ready"
      ? attachment.status
      : attachment.mimeType === "application/pdf" && attachment.pages?.length
        ? "可读取 PDF"
        : "仅元信息可用"
  return (
    `  <file id="${attachment.id}" name="${escapeAttachmentAttribute(attachment.filename)}" ` +
    `mime="${escapeAttachmentAttribute(attachment.mimeType)}" size="${attachment.size}" ` +
    `status="${contentState}"${explicit ? ' source="message-attachment"' : ""} />`
  )
}
