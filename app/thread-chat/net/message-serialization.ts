import type { Message, ThreadTreeState } from "../core/types"

/**
 * 把领域消息编译为模型可见文本。Artifact 不保存 AI SDK tool parts，因此用明确边界
 * 回放标题与原始内容，让“修改刚才的 Markdown”等追问仍有完整 grounding。
 */
export function serializeMessageForModel(
  state: ThreadTreeState,
  message: Message
): string | null {
  const sections: string[] = []
  const body = message.quote?.text
    ? `就我划选的这段话：「${message.quote.text}」——${message.text}`
    : message.text
  if (body.trim()) sections.push(body)

  for (const artifactId of message.artifactIds ?? []) {
    const artifact = state.artifacts[artifactId]
    if (!artifact) continue
    if (artifact.kind !== "markdown") continue
    sections.push(
      `[Markdown Artifact: ${artifact.title}]\n${artifact.content}\n[/Markdown Artifact]`
    )
  }

  const serialized = sections.join("\n\n").trim()
  return serialized || null
}
