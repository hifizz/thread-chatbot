import type { Message, ThreadTreeState } from "@/lib/thread-chat/domain/types"
import { quoteTextToModelText } from "@/lib/thread-chat/application/quote-model"

/**
 * Legacy tree compatibility serializer. New normalized messages are converted
 * from ordered UI Parts by the Prompt Compiler; this path uses the same Quote
 * model format so cache behavior does not depend on the entry point.
 */
export function serializeMessageForModel(
  state: ThreadTreeState,
  message: Message
): string | null {
  const sections: string[] = []
  if (message.quote?.text) sections.push(quoteTextToModelText(message.quote.text))
  if (message.text.trim()) sections.push(message.text)

  for (const artifactId of message.artifactIds ?? []) {
    const artifact = state.artifacts[artifactId]
    if (!artifact || artifact.kind !== "markdown") continue
    sections.push(
      `[Markdown Artifact: ${artifact.title}]\n${artifact.content}\n[/Markdown Artifact]`
    )
  }

  const serialized = sections.join("\n\n").trim()
  return serialized || null
}
