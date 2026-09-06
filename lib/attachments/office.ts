import ExcelJS from "exceljs"
import { parse } from "csv-parse/sync"
import { OfficeParser, type OfficeContentNode } from "officeparser"
import {
  OFFICE_ATTACHMENT_LIMITS as LIMITS,
  OFFICE_ATTACHMENT_MIME_BY_EXTENSION as MIME,
  type OfficeAttachmentMimeType,
} from "@/constants/office-attachment"
import { inspectOfficeArchive } from "@/lib/attachments/office-archive"
import { orderPresentationNodes } from "@/lib/attachments/presentation-order"

/** pages 保存带真实位置标识的文本片段；Office 不伪造 PDF 页码。 */
export type OfficeExtraction = { pages: string[] }

function boundedSegments() {
  const pages: string[] = []
  let total = 0
  return {
    pages,
    add(text: string) {
      if (!text.trim()) return
      total += text.length
      if (total > LIMITS.maxExtractedChars || pages.length >= LIMITS.maxSegments) {
        throw new Error("文档内容过多，请拆分文件后上传")
      }
      pages.push(text)
    },
  }
}

function nodeText(node: OfficeContentNode): string {
  let body: string
  if (node.type === "image" || node.type === "chart" || node.type === "drawing") {
    return "[图片或图表：未提取视觉内容]"
  }
  if (node.type === "row") {
    body = (node.children ?? []).map((cell) => JSON.stringify(nodeText(cell))).join(" | ")
  } else if (node.type === "table") {
    body = `[表格：每行为一条记录，单元格以 | 分隔]\n${(node.children ?? []).map(nodeText).join("\n")}`
  } else {
    // 父节点的聚合 text 不包含子节点上的脚注/图片；必须遍历子节点，不能只读聚合值。
    const children = node.children ?? []
    const inline = children.every((child) => child.type === "text" || child.type === "code")
    body = children.length ? children.map(nodeText).join(inline ? "" : "\n") : node.text ?? ""
  }
  if (node.notes?.length) body += `\n[备注/脚注]\n${node.notes.map(nodeText).join("\n")}`
  return body
}

function cellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== "object") return String(value)
  if ("richText" in value) return value.richText.map((part) => part.text).join("")
  if ("text" in value) return value.text
  if ("error" in value) return value.error
  if ("formula" in value || "sharedFormula" in value) {
    const formula = "formula" in value ? value.formula : `共享公式 ${value.sharedFormula}`
    return `公式: ${formula}; 缓存结果: ${value.result === undefined ? "未提供" : cellValue(value.result)}`
  }
  return ""
}

async function extractWorkbook(bytes: Uint8Array): Promise<OfficeExtraction> {
  await inspectOfficeArchive(bytes, "xl/workbook.xml")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
  const output = boundedSegments()
  let cellCount = 0
  for (const sheet of workbook.worksheets) {
    const label = `[工作表 ${JSON.stringify(sheet.name)}${sheet.state !== "visible" ? "（隐藏）" : ""}]`
    let lines: string[] = []
    let header = ""
    const flush = () => {
      if (!lines.length) return
      output.add(`${label}\n${header ? `[首个非空行，供理解列名]\n${header}\n` : ""}${lines.join("\n")}`)
      lines = []
    }
    sheet.eachRow((row) => {
      const cells: string[] = []
      row.eachCell((cell) => {
        cellCount += 1
        if (cellCount > LIMITS.maxTableCells) throw new Error("表格单元格过多，请拆分后上传")
        // 合并区域只输出主单元格，保留从属格所指向的位置，避免重复计数。
        if (cell.isMerged && cell.master.address !== cell.address) {
          cells.push(`${cell.address}=合并至 ${cell.master.address}`)
          return
        }
        const value = cellValue(cell.value)
        if (!value) return
        const format = cell.numFmt && cell.numFmt !== "General" ? ` (格式 ${JSON.stringify(cell.numFmt)})` : ""
        cells.push(`${cell.address}=${JSON.stringify(value)}${format}`)
      })
      if (!cells.length) return
      const line = cells.join(" | ")
      if (!header) header = line
      lines.push(line)
      if (lines.length >= LIMITS.rowsPerSegment) flush()
    })
    flush()
  }
  return { pages: output.pages }
}

function extractCsv(bytes: Uint8Array): OfficeExtraction {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("CSV 编码无法识别，请另存为 UTF-8 CSV 后上传")
  }
  const output = boundedSegments()
  let lines: string[] = []
  let header = ""
  let rowNumber = 0
  let cellCount = 0
  const flush = () => {
    if (!lines.length) return
    output.add(`[CSV：单元格为 JSON 字符串，行号按记录计算]\n[首行] ${header}\n${lines.join("\n")}`)
    lines = []
  }
  // on_record 不累积全量 records；不自动转数字，保留编号前导零。
  parse(text, {
    bom: true,
    relax_column_count: true,
    max_record_size: LIMITS.maxCsvRecordChars,
    on_record(record: string[]) {
      rowNumber += 1
      cellCount += record.length
      if (cellCount > LIMITS.maxTableCells) throw new Error("表格单元格过多，请拆分后上传")
      if (record.every((value) => value === "")) return null
      const line = `第 ${rowNumber} 行: ${record.map((value, index) => `第 ${index + 1} 列=${JSON.stringify(value)}`).join(" | ")}`
      if (!header) header = line
      lines.push(line)
      if (lines.length >= LIMITS.rowsPerSegment) flush()
      return null
    },
  })
  flush()
  return { pages: output.pages }
}

export async function extractOfficeDocument(bytes: Uint8Array, mime: OfficeAttachmentMimeType): Promise<OfficeExtraction> {
  if (!bytes.length || bytes.length > LIMITS.maxBytes) throw new Error("文件为空或超过大小上限")
  let result: OfficeExtraction
  if (mime === MIME[".xlsx"]) {
    result = await extractWorkbook(bytes)
  } else if (mime === MIME[".csv"]) {
    result = extractCsv(bytes)
  } else {
    const pptx = mime === MIME[".pptx"]
    const parts = await inspectOfficeArchive(bytes, pptx ? "ppt/presentation.xml" : "word/document.xml")
    const ast = await OfficeParser.parseOffice(Buffer.from(bytes), {
      fileType: pptx ? "pptx" : "docx",
      ocr: false,
      extractAttachments: false,
      ignoreNotes: false,
      ignoreComments: true,
      ignoreSlideMasters: true,
      decompressionLimits: LIMITS,
    })
    const output = boundedSegments()
    const content = pptx ? orderPresentationNodes(ast.content, parts) : ast.content
    for (const [index, node] of content.entries()) {
      const text = nodeText(node)
      if (text.trim()) output.add(`[${pptx ? "幻灯片" : "段落"} ${index + 1}]\n${text}`)
    }
    for (const node of [...(ast.auxiliary?.headers ?? []), ...(ast.auxiliary?.footers ?? [])]) {
      const text = nodeText(node)
      if (text.trim()) output.add(`[页眉/页脚]\n${text}`)
    }
    result = { pages: output.pages }
  }
  if (!result.pages.length || result.pages.every((page) => !page.replace(/\[[^\]]*\]/g, "").trim())) {
    throw new Error("文件没有可提取的正文或表格；图片/扫描内容暂不支持，请转为有文本的文件")
  }
  return result
}
