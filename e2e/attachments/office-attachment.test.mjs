import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { extractOfficeDocument } from "../../lib/attachments/office.ts"
import { extractedAttachmentContent } from "../../lib/attachments/extracted-content.ts"
import { renderOfficeAttachment, renderPdfAttachment } from "../../lib/chat/attachment-content-resolver.ts"
import { resolveAttachmentContext } from "../../lib/chat/resolve-attachments.ts"
import { normalizeAttachmentFile } from "../../lib/attachments/upload.ts"
import { isThreadComposerFile, THREAD_COMPOSER_ACCEPT } from "../../app/thread-chat/chat/composer/thread-attachment-model.ts"
import { assertOwnedReadyAttachments, assertModelSupportsNewAttachments } from "../../lib/thread-chat/application/command-utils.ts"
import { OFFICE_ATTACHMENT_MIME_BY_EXTENSION as MIME } from "../../constants/office-attachment.ts"
import { extractPdfPages, hasTextLayer } from "../../lib/attachments/pdf.ts"

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url))
const word = await extractOfficeDocument(await fixture("office-word.docx"), MIME[".docx"])
const wordText = word.pages.join("\n")
assert.match(wordText, /中文办公报告 & 安全字符/)
assert.match(wordText, /预算A.*1200/s)
assert.match(wordText, /预算脚注：单位为元/)
assert.match(wordText, /表格/)

const slides = await extractOfficeDocument(await fixture("office-slides.pptx"), MIME[".pptx"])
assert.equal(slides.pages.length, 2)
assert.match(slides.pages[0], /幻灯片 1.*第一页：方案总览.*第一页备注：只介绍目标/s)
assert.doesNotMatch(slides.pages[0], /第二页备注/)
assert.match(slides.pages[1], /幻灯片 2.*第二页：详细预算.*第二页备注：预算上限1200/s)

const workbook = new ExcelJS.Workbook()
const sheet = workbook.addWorksheet("销售 & 地区")
sheet.addRow(["编号", "金额", "日期", "比例"])
sheet.addRow(["00123", 1200, new Date("2026-09-06T00:00:00Z"), 0.125])
sheet.getCell("D2").numFmt = "0.0%"
sheet.getCell("B3").value = { formula: "B2*2", result: 2400 }
sheet.getCell("B4").value = { formula: "B2*3" }
sheet.getCell("A6").value = "合并标题"
sheet.mergeCells("A6:B6")
sheet.getCell("C8").value = false
sheet.getCell("D8").value = 0
sheet.getCell("B50").value = "末尾行"
const other = workbook.addWorksheet("隐藏资料", { state: "hidden" })
other.getCell("C9").value = "第二工作表内容"
const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
const excel = await extractOfficeDocument(bytes, MIME[".xlsx"])
const excelText = excel.pages.join("\n")
assert.match(excelText, /工作表 "销售 & 地区"/)
assert.match(excelText, /A2="00123"/)
assert.match(excelText, /C2="2026-09-06T00:00:00.000Z"/)
assert.match(excelText, /D2="0.125" \(格式 "0.0%"\)/)
assert.match(excelText, /B2\*2; 缓存结果: 2400/)
assert.match(excelText, /B2\*3; 缓存结果: 未提供/)
assert.match(excelText, /B6=合并至 A6/)
assert.match(excelText, /C8="false".*D8="0"/)
assert.match(excelText, /B50="末尾行"/)
assert.match(excelText, /工作表 "隐藏资料"（隐藏）.*C9="第二工作表内容"/s)

const csv = await extractOfficeDocument(new TextEncoder().encode('\uFEFF编号,描述,金额\r\n001,"带逗号,和""引号""\n第二行",0\r\n002,,10'), MIME[".csv"])
const csvText = csv.pages.join("\n")
assert.ok(csvText.includes('第 1 列="001"'))
assert.ok(csvText.includes(JSON.stringify('带逗号,和"引号"\n第二行')))
assert.ok(csvText.includes('第 2 列="" | 第 3 列="10"'))
await assert.rejects(() => extractOfficeDocument(new Uint8Array([0xff]), MIME[".csv"]), /UTF-8/)
await assert.rejects(() => extractOfficeDocument(new TextEncoder().encode('a,"unterminated'), MIME[".csv"]))
await assert.rejects(() => extractOfficeDocument(new Uint8Array(), MIME[".csv"]), /文件为空/)
await assert.rejects(() => extractOfficeDocument(new Uint8Array([1, 2, 3]), MIME[".docx"]))
await assert.rejects(async () => extractOfficeDocument(await fixture("office-wrong-type.docx"), MIME[".docx"]), /类型不一致/)
await assert.rejects(async () => extractOfficeDocument(await fixture("office-entity.docx"), MIME[".docx"]), /自定义 XML 实体/)

for (const [ext, mime] of [...Object.entries(MIME), [".pdf", "application/pdf"]]) {
  const source = new File(["fixture"], `报告${ext.toUpperCase()}`, { type: "application/octet-stream" })
  assert.equal(normalizeAttachmentFile(source).type, mime)
  assert.equal(isThreadComposerFile(source), true)
  assert.ok(THREAD_COMPOSER_ACCEPT.includes(ext))
}
assert.equal(normalizeAttachmentFile(new File(["a,b"], "data.csv", { type: "application/vnd.ms-excel" })).type, MIME[".csv"])
for (const ext of [".doc", ".xls", ".ppt", ".zip", ".mp4"]) {
  assert.equal(isThreadComposerFile(new File(["x"], `test${ext}`, { type: "application/octet-stream" })), false)
}

const row = { id: crypto.randomUUID(), userId: "owner", filename: '报告".xlsx', mimeType: MIME[".xlsx"], status: "ready", pages: excel.pages, pageCount: null, key: "private/key", size: bytes.length, kind: "document", error: null }
const full = renderOfficeAttachment(row, 120_000)
assert.equal(full.mode, "full")
assert.ok(full.text.includes(extractedAttachmentContent(row)))
assert.match(full.text, /name="报告&quot;.xlsx"/)
assert.doesNotMatch(full.text, /#page=|原生|base64/)
for (const budget of [0, 12, 100, 500]) {
  const rendered = renderOfficeAttachment(row, budget)
  assert.ok(rendered.text.length <= budget)
  assert.equal(rendered.mode, "fallback")
}
assert.match(renderOfficeAttachment(row, 500).text, /已截断/)
const ref = { type: "file", url: `/api/attachments/${row.id}`, mediaType: row.mimeType, filename: row.filename }
const messages = [{ id: "message", role: "user", parts: [{ type: "text", text: "读取金额" }, ref] }]
const resolved = await resolveAttachmentContext({ messages, userId: "owner", loadRows: async () => new Map([[row.id, row]]), readObjectBytes: async () => { throw new Error("Office 对话不应再次下载解析原文件") } })
assert.equal(resolved.messages[0].parts[1].type, "text")
assert.match(resolved.messages[0].parts[1].text, /缓存结果: 2400/)
assert.equal(messages[0].parts[1].type, "file", "持久化引用不得被模型上下文转换覆盖")
assert.equal(resolved.imageFiles.length, 0)
const denied = await resolveAttachmentContext({ messages, userId: "other", loadRows: async () => new Map() })
assert.doesNotMatch(denied.messages[0].parts[1].text, /缓存结果: 2400/)

const tx = (rows) => ({ select: () => ({ from: () => ({ where: async () => rows }) }) })
await assertOwnedReadyAttachments(tx([{ id: row.id, mimeType: row.mimeType }]), "owner", [ref])
await assert.rejects(() => assertOwnedReadyAttachments(tx([]), "owner", [ref]))
await assert.rejects(() => assertOwnedReadyAttachments(tx([{ id: row.id, mimeType: "text/plain" }]), "owner", [ref]))
assert.doesNotThrow(() => assertModelSupportsNewAttachments("non-vision-model", [ref]))

const pdf = await extractPdfPages(new Uint8Array(await readFile(new URL("../../evals/agent/fixtures/synthetic-report.pdf", import.meta.url))))
assert.equal(hasTextLayer(pdf), true)
assert.ok(extractedAttachmentContent({ mimeType: "application/pdf", pages: pdf.pages }).includes("[第 1 页]"))
const clippedPdf = await renderPdfAttachment({ ...row, mimeType: "application/pdf", pages: ["长页".repeat(100)], pageCount: 1 }, 50, "")
assert.match(clippedPdf.text, /已截断/)
console.log("office attachment parsing, model context, ownership and PDF regression passed")
