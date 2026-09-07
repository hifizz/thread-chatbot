import { isToolUIPart } from "ai"
import type { ThreadChatUIMessage } from "../contracts/ui-message"
import { artifactReferenceDataSchema, type ReferenceArtifact } from "../contracts/artifact-reference"
import { ARTIFACT_REFERENCE_COPY } from "@/constants/artifact-reference"
import { collectFinalArtifacts } from "../streaming/artifacts"

/** 仅认可 SDK 会发送的完整工具输入，并核对不可变产物身份与正文。 */
function includedSourceArtifact(
  message: ThreadChatUIMessage,
  part: ThreadChatUIMessage["parts"][number],
  artifacts: Map<string, ReferenceArtifact>
): string | null {
  if (message.role !== "assistant" || !isToolUIPart(part)
    || part.state !== "output-available" || part.preliminary === true) return null
  const source = collectFinalArtifacts(message.id, [part])[0]
  if (!source) return null
  const artifact = artifacts.get(source.id)
  const output = part.output
  if (!artifact || artifact.sourceMessageId !== message.id
    || artifact.kind !== source.kind || artifact.title !== source.title || artifact.content !== source.content
    || typeof output !== "object" || output === null
    || !("artifactId" in output) || output.artifactId !== artifact.id) return null
  return artifact.id
}

/**
 * 在已选定的实际历史（含 forkContext）上从前往后处理。
 * 不预扫描后文、不改写工具调用、不改变原消息；新增追问只追加固定引用标记。
 */
export function expandArtifactReferencesInContext(
  messages: ThreadChatUIMessage[],
  artifacts: Map<string, ReferenceArtifact>
): ThreadChatUIMessage[] {
  const seen = new Set<string>()
  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part) => {
      const sourceId = includedSourceArtifact(message, part, artifacts)
      if (sourceId) seen.add(sourceId)
      return expandArtifactReferenceParts([part], artifacts, seen)
    }),
  }))
}

/** 固定字段与顺序；重复标记不带轮次、位置或时间，保持可缓存的历史前缀。 */
export function artifactReferenceForModel(artifact: ReferenceArtifact, seen: Set<string>): string {
  const repeated = seen.has(artifact.id)
  seen.add(artifact.id)
  return JSON.stringify({
    contextType: "artifact-reference",
    artifactId: artifact.id,
    title: artifact.title,
    ...(repeated ? { previouslyIncludedInContext: true } : {
      kind: artifact.kind,
      content: artifact.content,
    }),
  })
}

export function expandArtifactReferenceParts(
  parts: ThreadChatUIMessage["parts"],
  artifacts: Map<string, ReferenceArtifact>,
  seen: Set<string> = new Set()
): ThreadChatUIMessage["parts"] {
  return parts.map((part) => {
    if (part.type !== "data-artifact-reference") return part
    const artifact = artifacts.get(artifactReferenceDataSchema.parse(part.data).artifactId)
    if (!artifact) throw new Error(ARTIFACT_REFERENCE_COPY.missing)
    return { type: "text" as const, text: artifactReferenceForModel(artifact, seen) }
  })
}
