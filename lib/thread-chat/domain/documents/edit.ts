import { DOCUMENT_LIMITS } from "@/constants/project-documents"
import { markdownEditSchema, type MarkdownEdit, type DocumentEditError } from "../../contracts/document"

export type DocumentPatchResult = { ok: true; content: string; changed: boolean } | { ok: false; code: DocumentEditError }
/** 所有范围针对原始 Markdown，先全部验证，再倒序应用。 */
export function applyDocumentEdits(content: string, edits: readonly MarkdownEdit[]): DocumentPatchResult {
  if (!edits.length || edits.length > DOCUMENT_LIMITS.edits || content.length > DOCUMENT_LIMITS.contentChars)
    return { ok: false, code: "INVALID_EDIT" }
  const ranges: Array<{ start: number; end: number; text: string }> = []
  let inputChars = 0
  for (const edit of edits) {
    if (!markdownEditSchema.safeParse(edit).success) return { ok: false, code: "INVALID_EDIT" }
    inputChars += edit.oldText.length + edit.newText.length
    if (inputChars > DOCUMENT_LIMITS.editChars) return { ok: false, code: "INVALID_EDIT" }
    const start = content.indexOf(edit.oldText)
    if (start < 0) return { ok: false, code: "SOURCE_NOT_FOUND" }
    if (content.indexOf(edit.oldText, start + 1) >= 0) return { ok: false, code: "SOURCE_AMBIGUOUS" }
    ranges.push({ start, end: start + edit.oldText.length, text: edit.newText })
  }
  ranges.sort((a, b) => a.start - b.start)
  if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end))
    return { ok: false, code: "OVERLAPPING_EDITS" }
  let next = content
  for (const range of ranges.reverse()) next = next.slice(0, range.start) + range.text + next.slice(range.end)
  if (!next.trim() || next.length > DOCUMENT_LIMITS.contentChars) return { ok: false, code: "INVALID_EDIT" }
  return { ok: true, content: next, changed: next !== content }
}
