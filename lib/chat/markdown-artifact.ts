import { z } from "zod"
import { parsePartialJson } from "ai"

export const MARKDOWN_ARTIFACT_TOOL_NAME = "createMarkdownArtifact" as const
export const MARKDOWN_ARTIFACT_TITLE_MAX_LEN = 80
export const MARKDOWN_ARTIFACT_CONTENT_MAX_CHARS = 64_000

export interface MarkdownArtifactInput {
  title: string
  content: string
}

export interface MarkdownArtifactToolResult {
  created: true
}

/**
 * 模型偶尔会把整份 Markdown 再包进一个 markdown/md 围栏。只拆覆盖全文的
 * 单个外层围栏；正文内部的代码围栏保持原样。
 */
export function normalizeMarkdownArtifactInput(
  input: MarkdownArtifactInput
): MarkdownArtifactInput {
  const title = input.title.trim()
  const raw = input.content.trim()
  const outerFence = raw.match(
    /^```(?:markdown|md)[\t ]*\r?\n([\s\S]*)\r?\n```[\t ]*$/i
  )
  return { title, content: (outerFence?.[1] ?? raw).trim() }
}

const rawMarkdownArtifactInputSchema = z.object({
  title: z.string().trim().min(1).max(MARKDOWN_ARTIFACT_TITLE_MAX_LEN),
  content: z.string().trim().min(1).max(MARKDOWN_ARTIFACT_CONTENT_MAX_CHARS),
})

/** 服务端工具输入的单一校验入口；transform 保证流到客户端的 input 已归一化。 */
export const markdownArtifactInputSchema = rawMarkdownArtifactInputSchema
  .transform(normalizeMarkdownArtifactInput)
  .refine((value) => value.content.length > 0, {
    path: ["content"],
    message: "Markdown content must not be empty after normalization",
  })

/**
 * 只识别用户明确要求“独立交付物”的高置信表达。该结果同时控制工具是否挂载，
 * 因此刻意宁可漏判，也不把普通长回答、分析、总结或 Markdown 排版误判成文件产物。
 */
export function isExplicitMarkdownArtifactRequest(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const conceptQuestion =
    /^(?:请问[，,：:]?)?(?:(?:什么是|如何|怎么|怎样).{0,40}(?:markdown[\t ]*(?:文件|文档|格式)?|\.md|md[\t ]*(?:文件|文档|格式))|(?:markdown[\t ]*(?:文件|文档|格式)?|\.md|md[\t ]*(?:文件|文档|格式)).{0,30}(?:是什么|什么意思|怎么用|如何使用|语法|区别))\s*[？?。.]?$|^(?:what\s+is|what\s+does|how\s+(?:do|does|to)|explain|difference)\b.{0,60}\b(?:markdown(?:\s+(?:file|document))?|md\s+(?:file|document))\b\s*[?.]*$/i.test(
      normalized
    )
  const instructionQuestion =
    /^(?:请问[，,：:]?)?(?:(?:如何|怎么|怎样).{0,60}(?:创建|生成|撰写|写|制作|输出|导出|保存).{0,40}(?:文件|文档|产物|附件|文章|报告|文稿|稿件|博客|博文|教程|说明书|成稿|内容)|(?:这个|这份|该|一个|一份)?(?:文件|文档|产物|附件|文章|报告|文稿|稿件|博客|博文|教程|说明书|成稿|内容).{0,30}(?:如何|怎么|怎样).{0,30}(?:创建|生成|撰写|写|制作|输出|导出|保存))|^how\s+(?:do\s+i|can\s+i|to)\b.{0,60}\b(?:create|generate|write|draft|produce|export|save)\b.{0,60}\b(?:file|document|artifact|article|report|manuscript|blog\s+post|tutorial|markdown)\b/i.test(
      normalized
    )
  if (conceptQuestion || instructionQuestion) return false

  const chineseArtifact =
    /(?:(?:帮我|请|为我).{0,8})?(?:创建|生成|输出|整理成|制作|写成|写为|改写成|转换成|转成|导出|保存为|交付).{0,30}(?:markdown|\.md|md[\t ]*(?:文件|文档|格式)|文件|文档|产物|附件)|(?:给我|提供)(?:[\s：:，,]*(?:一份|一个|一篇|该|这份|这个))?[\s：:，,]*(?:markdown|\.md|md[\t ]*(?:文件|文档|格式)|文件|文档|产物|附件)|(?:markdown|\.md|md[\t ]*(?:文件|文档|格式)|文件|文档|产物|附件).{0,30}(?:创建|生成|输出|整理|制作|写成|写为|改写|转换|转成|导出|保存|交付)/i.test(
      normalized
    )
  const chineseLongForm =
    /(?:(?:帮我|请|为我).{0,8})?(?:创建|生成|撰写|写|创作|制作|输出|交付).{0,20}(?:(?:一|这)(?:篇|份|个))?(?:文章|报告|文稿|稿件|博客|博文|教程|说明书|成稿)|(?:给我|提供)[\s：:，,]*(?:一篇|一份|一个)(?:文章|报告|文稿|稿件|博客|博文|教程|说明书|内容|成稿)|(?:生成|创建|撰写|写|输出).{0,20}(?:一篇|一份|一个)(?:内容|成稿)/i.test(
      normalized
    )
  const englishArtifact =
    /\b(?:create|generate|output|convert|export|produce|deliver|provide|return|save)\b.{0,60}\b(?:markdown|md\s+(?:file|document)|file|document|artifact|deliverable)\b|\b(?:markdown|md\s+(?:file|document)|file|document|artifact|deliverable)\b.{0,60}\b(?:create|generate|output|convert|export|produce|deliver|provide|return|save)\b|\b(?:create|generate|write|draft|produce)\b.{0,60}\b(?:article|report|manuscript|blog\s+post|tutorial)\b/i.test(
      normalized
    )

  return chineseArtifact || chineseLongForm || englishArtifact
}

export interface ToolInputAvailableChunk {
  type: "tool-input-available"
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ToolInputStartChunk {
  type: "tool-input-start"
  toolCallId: string
  toolName: string
}

export interface ToolInputDeltaChunk {
  type: "tool-input-delta"
  toolCallId: string
  inputTextDelta: string
}

export interface MarkdownArtifactProgressEvent {
  toolCallId: string
  phase: "starting" | "streaming"
  partialTitle?: string
  characterCount: number
  lineCount: number
  headings: string[]
}

export interface MarkdownArtifactStreamEvent {
  toolCallId: string
  toolName: typeof MARKDOWN_ARTIFACT_TOOL_NAME
  input: MarkdownArtifactInput
}

export function isMarkdownArtifactInputStart(
  chunk: unknown
): chunk is ToolInputStartChunk {
  if (typeof chunk !== "object" || chunk === null) return false
  const value = chunk as Record<string, unknown>
  return (
    value.type === "tool-input-start" &&
    value.toolName === MARKDOWN_ARTIFACT_TOOL_NAME &&
    typeof value.toolCallId === "string" &&
    value.toolCallId.trim() !== ""
  )
}

export function isToolInputDelta(chunk: unknown): chunk is ToolInputDeltaChunk {
  if (typeof chunk !== "object" || chunk === null) return false
  const value = chunk as Record<string, unknown>
  return (
    value.type === "tool-input-delta" &&
    typeof value.toolCallId === "string" &&
    value.toolCallId.trim() !== "" &&
    typeof value.inputTextDelta === "string"
  )
}

/** 从 AI SDK 修复后的局部 JSON 中提取可安全展示的真实进度。 */
export function markdownArtifactProgressFromPartialInput(
  toolCallId: string,
  input: unknown
): MarkdownArtifactProgressEvent {
  const value =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {}
  const partialTitle =
    typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : undefined
  const content = typeof value.content === "string" ? value.content : ""
  const headings = [...content.matchAll(/^#{1,6}[\t ]+(.+?)\s*#*\s*$/gm)]
    .map((match) => match[1]?.trim())
    .filter((heading): heading is string => Boolean(heading))
    .slice(-3)

  return {
    toolCallId,
    phase: "streaming",
    ...(partialTitle ? { partialTitle } : {}),
    characterCount: content.length,
    lineCount: content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length,
    headings,
  }
}

/**
 * 为单次响应创建 Markdown 工具输入进度分派器。start 建立缓冲，delta 按序累积
 * 并用 AI SDK 的局部 JSON 修复器解析；complete 只负责释放缓冲，交给完整事件分派器。
 */
export function createMarkdownArtifactProgressDispatcher(
  onProgress: (event: MarkdownArtifactProgressEvent) => void
): (chunk: unknown) => Promise<boolean> {
  const inputBuffers = new Map<string, string>()

  return async (chunk) => {
    if (isMarkdownArtifactInputStart(chunk)) {
      inputBuffers.set(chunk.toolCallId, "")
      onProgress({
        toolCallId: chunk.toolCallId,
        phase: "starting",
        characterCount: 0,
        lineCount: 0,
        headings: [],
      })
      return true
    }

    if (isToolInputDelta(chunk) && inputBuffers.has(chunk.toolCallId)) {
      const inputText =
        (inputBuffers.get(chunk.toolCallId) ?? "") + chunk.inputTextDelta
      inputBuffers.set(chunk.toolCallId, inputText)
      const { value } = await parsePartialJson(inputText)
      onProgress(
        markdownArtifactProgressFromPartialInput(chunk.toolCallId, value)
      )
      return true
    }

    if (isMarkdownArtifactStreamEvent(chunk)) {
      inputBuffers.delete(chunk.toolCallId)
    }
    return false
  }
}

/** 客户端流边界的轻量守卫；服务端 Zod 已做长度和 trim 校验。 */
export function isMarkdownArtifactStreamEvent(
  chunk: unknown
): chunk is MarkdownArtifactStreamEvent {
  if (typeof chunk !== "object" || chunk === null) return false
  const value = chunk as Record<string, unknown>
  if (
    value.type !== "tool-input-available" ||
    value.toolName !== MARKDOWN_ARTIFACT_TOOL_NAME ||
    typeof value.toolCallId !== "string" ||
    value.toolCallId.trim() === "" ||
    typeof value.input !== "object" ||
    value.input === null
  )
    return false
  const input = value.input as Record<string, unknown>
  return (
    typeof input.title === "string" &&
    input.title.trim() !== "" &&
    typeof input.content === "string" &&
    input.content.trim() !== ""
  )
}

/**
 * 为单次响应创建工具输入分派器。返回 true 表示该 chunk 属于 Markdown 工具
 * （包括已处理过的重复 call id）；未知或损坏事件返回 false 交给其它 chunk 分支。
 */
export function createMarkdownArtifactEventDispatcher(
  onEvent: (event: MarkdownArtifactStreamEvent) => void
): (chunk: unknown) => boolean {
  const seenToolCallIds = new Set<string>()
  return (chunk) => {
    if (!isMarkdownArtifactStreamEvent(chunk)) return false
    if (!seenToolCallIds.has(chunk.toolCallId)) {
      seenToolCallIds.add(chunk.toolCallId)
      onEvent(chunk)
    }
    return true
  }
}

export const MARKDOWN_ARTIFACT_TOOL_DESCRIPTION = `
Create one standalone Markdown artifact only when the user explicitly asks for an independent deliverable, such as an article, document, file, report, Markdown/.md file, or artifact. Put directly renderable raw Markdown in content; do not wrap the whole document in an outer markdown code fence. When the user explicitly requests multiple separate documents, call this tool once for each document in the same reply, with one title/content pair per call. Never call it merely because an answer is long, structured, uses Markdown formatting, summarizes research, or contains headings and lists.

仅当用户明确要求文章、文档、文件、报告、Markdown/.md 或“产物”等独立交付物时，才创建 Markdown 产物。content 必须是可直接渲染的原始 Markdown，不要给整份文档再套一层 markdown 代码围栏。用户明确要求多份独立文档时，必须在同一回复中为每一份分别调用一次本工具。不要因为回答较长、结构化、使用 Markdown 排版、总结研究结果或包含标题列表就调用本工具。
`.trim()
