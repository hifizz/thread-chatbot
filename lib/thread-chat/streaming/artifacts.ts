import { artifactIdForTool } from "../domain/tool-identity"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { markdownArtifactInputSchema } from "@/lib/chat/markdown-artifact"

export interface FinalArtifact {
  id: string
  kind: "markdown"
  title: string
  content: string
  language: null
  metadata: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function toolName(part: Record<string, unknown>): string | null {
  if (part.type === "dynamic-tool") {
    return typeof part.toolName === "string" ? part.toolName : null
  }
  return typeof part.type === "string" && part.type.startsWith("tool-")
    ? part.type.slice(5)
    : null
}

export function collectFinalArtifacts(
  messageId: string,
  parts: ThreadChatUIMessage["parts"]
): FinalArtifact[] {
  const collected: FinalArtifact[] = []
  for (const raw of parts) {
    const part = record(raw)
    if (!part || toolName(part) !== "createMarkdownArtifact") continue
    if (typeof part.toolCallId !== "string") continue
    const parsed = markdownArtifactInputSchema.safeParse(part.input)
    const output = record(part.output)
    if (!parsed.success || output?.created !== true) continue
    const id = artifactIdForTool(messageId, part.toolCallId)
    collected.push({
      id,
      kind: "markdown",
      title: parsed.data.title,
      content: parsed.data.content,
      language: null,
      metadata: { toolCallId: part.toolCallId },
    })
  }
  return collected
}

export interface ArtifactCallStats {
  /** createMarkdownArtifact 工具调用总次数（含未完成的调用）。 */
  attempted: number
  /** 终态确认产出（created=true 且输入合规）的次数。 */
  produced: number
}

/**
 * 统计一轮生成里 artifact 工具的调用与产出，供 finalize 打诊断事件：
 * attempted > produced 即「模型调了但参数不合规 / 中途失败 / 没产出」，
 * attempted = 0 而 generationMode 为 *-artifact 即「强制兜底仍漏调」。
 */
export function artifactCallStats(
  parts: ThreadChatUIMessage["parts"]
): ArtifactCallStats {
  let attempted = 0
  let produced = 0
  for (const raw of parts) {
    const part = record(raw)
    if (!part || toolName(part) !== "createMarkdownArtifact") continue
    attempted += 1
    const parsed = markdownArtifactInputSchema.safeParse(part.input)
    const output = record(part.output)
    if (parsed.success && output?.created === true) produced += 1
  }
  return { attempted, produced }
}

export function hasDisplayableParts(
  parts: ThreadChatUIMessage["parts"]
): boolean {
  return parts.some((raw) => {
    const part = record(raw)
    if (!part || typeof part.type !== "string") return false
    if (part.type === "text")
      return typeof part.text === "string" && part.text.trim().length > 0
    if (part.type === "reasoning" || part.type === "step-start") return false
    return (
      part.type === "file" ||
      part.type.startsWith("source-") ||
      part.type.startsWith("tool-") ||
      part.type === "dynamic-tool" ||
      part.type.startsWith("data-")
    )
  })
}
