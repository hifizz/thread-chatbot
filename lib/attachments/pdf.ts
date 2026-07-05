import { extractText, getDocumentProxy } from "unpdf"

const PDF_MAGIC = "%PDF-"

/** 魔数校验：Content-Type 声明不可信，解析前确认字节确实是 PDF（OWASP CWE-434） */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("ascii").decode(bytes.slice(0, PDF_MAGIC.length))
  return head === PDF_MAGIC
}

export type PdfExtraction = {
  pageCount: number
  /** pages[i] = 第 i+1 页的文本（已 trim；可能为空串，如纯图片页） */
  pages: string[]
}

/** 按页提取 PDF 文本层。扫描件（无文本层）会得到全空页，由调用方决定如何失败。 */
export async function extractPdfPages(
  bytes: Uint8Array
): Promise<PdfExtraction> {
  const pdf = await getDocumentProxy(bytes)
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  return {
    pageCount: totalPages,
    pages: text.map((page) => page.replace(/\s+\n/g, "\n").trim()),
  }
}

/** 是否提取到了任何有效文本（全空视为无文本层） */
export function hasTextLayer(extraction: PdfExtraction): boolean {
  return extraction.pages.some((page) => page.length > 0)
}
