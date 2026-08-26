import { createHash } from "node:crypto"
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

export function artifactIdForTool(
  messageId: string,
  toolCallId: string
): string {
  const hex = createHash("sha256")
    .update(`${messageId}:${toolCallId}`)
    .digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
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
