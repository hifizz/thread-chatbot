import {
  isOfficeAttachmentMimeType,
  OFFICE_EXTRACTION_NOTICE,
  OFFICE_ATTACHMENT_MIME_BY_EXTENSION as MIME,
  SPREADSHEET_EXTRACTION_NOTICE,
} from "@/constants/office-attachment"

/** 同一份已保存的提取内容用于预览与模型读取，Office 位置由片段自身标注。 */
export function extractedAttachmentContent(row: { mimeType: string; pages: readonly string[] | null }): string | null {
  if (!row.pages?.length) return null
  if (row.mimeType === "application/pdf") {
    return row.pages.map((page, index) => `[第 ${index + 1} 页]\n${page}`).join("\n\n")
  }
  if (!isOfficeAttachmentMimeType(row.mimeType)) return null
  const spreadsheet = row.mimeType === MIME[".xlsx"] || row.mimeType === MIME[".csv"]
  return [OFFICE_EXTRACTION_NOTICE, ...(spreadsheet ? [SPREADSHEET_EXTRACTION_NOTICE] : []), ...row.pages].join("\n\n")
}
