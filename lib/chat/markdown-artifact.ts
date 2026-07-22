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
 * 只覆盖“可以安全强制工具”的高置信表达。完整的开放式语义识别由双语 tool
 * description + system prompt 完成；这里刻意宁可漏判，也不把概念问答误判成交付物。
 */
export function isExplicitMarkdownDeliverableRequest(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const mentionsFormat =
    /\bmarkdown\b|\.md\b|\bmd[\t ]+(?:file|document)\b|\bmd[\t ]*(?:文件|文档|格式)/i.test(
      normalized
    )
  if (!mentionsFormat) return false

  const conceptQuestion =
    /(?:什么是|是什么|什么意思|怎么用|如何使用|语法|教程|解释|介绍|区别)|\b(?:what\s+is|what\s+does|how\s+(?:do|does|to)|syntax|tutorial|explain|difference)\b/i.test(
      normalized
    )
  if (conceptQuestion) return false

  const chineseDeliverable =
    /(?:帮我|请|给我|提供|创建|生成|输出|整理|制作|写成|写为|改写|转换|转成|导出|总结成|表示成).{0,24}(?:markdown|\.md|md[\t ]*(?:文件|文档|格式))|(?:markdown|\.md|md[\t ]*(?:文件|文档|格式)).{0,24}(?:创建|生成|输出|整理|制作|写成|写为|改写|转换|转成|导出|总结|表示)/i.test(
      normalized
    )
  const englishDeliverable =
    /\b(?:create|generate|write|output|format|convert|export|produce|deliver|provide|return|summari[sz]e|present|turn)\b.{0,60}(?:\bmarkdown\b|\.md\b|\bmd[\t ]+(?:file|document)\b)|(?:\bmarkdown\b|\.md\b|\bmd[\t ]+(?:file|document)\b).{0,60}\b(?:create|generate|write|output|format|convert|export|produce|deliver|provide|return|summari[sz]e|present)\b/i.test(
      normalized
    )

  return chineseDeliverable || englishDeliverable
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
Create one standalone Markdown artifact for the user. Use this tool whenever the user semantically asks you to create, generate, write, output, organize, rewrite, convert, summarize into, or deliver a Markdown/.md document, regardless of whether they speak Chinese, English, mixed language, or use wording not shown in examples. Put directly renderable raw Markdown in content; do not wrap the whole document in an outer markdown code fence. Call at most once per reply. Do not call merely because a normal answer uses Markdown formatting, or when the user only asks what Markdown is or how its syntax works.

为用户创建一份独立的 Markdown 产物。只要用户表达了“创建、生成、撰写、输出、整理、改写、转换、总结成或交付一份 Markdown/.md 文档”的语义，就应调用本工具；中文、英文、中英混合或未出现在示例中的等价说法都适用。content 必须是可直接渲染的原始 Markdown，不要给整份文档再套一层 markdown 代码围栏；每次回复最多调用一次。仅仅因为普通回答使用 Markdown 排版，或者用户只是在询问 Markdown 的概念、用法、语法时，不要调用。
`.trim()
