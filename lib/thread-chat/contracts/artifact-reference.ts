import { z } from "zod"
import type { ThreadChatUIMessage } from "./ui-message"
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  ARTIFACT_REFERENCE_MAX_OCCURRENCES,
  ARTIFACT_REFERENCE_MAX_CHARS,
  ARTIFACT_REFERENCE_COPY,
} from "@/constants/artifact-reference"

/** 网络输入不接受客户端提供的正文、标题或来源关系。 */
export const artifactReferenceInputSchema = z.object({
  type: z.literal("artifact-reference"),
  artifactId: z.uuid(),
}).strict()

export const artifactReferenceDataSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_REFERENCE_SCHEMA_VERSION),
  artifactId: z.uuid(),
  title: z.string(),
  kind: z.enum(["markdown", "code", "note"]),
  threadId: z.uuid(),
  sourceMessageId: z.uuid(),
}).strict()

export type ArtifactReferenceData = z.infer<typeof artifactReferenceDataSchema>
export type ArtifactReferenceInput = z.infer<typeof artifactReferenceInputSchema>
export type InlineComposerPart =
  | { type: "text"; text: string }
  | ArtifactReferenceInput

export interface ReferenceArtifact {
  id: string
  title: string
  content: string
  kind: "markdown" | "code" | "note"
  threadId: string
  sourceMessageId: string
}

export function artifactReferenceData(artifact: ReferenceArtifact): ArtifactReferenceData {
  return {
    schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
    artifactId: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    threadId: artifact.threadId,
    sourceMessageId: artifact.sourceMessageId,
  }
}

export function assertArtifactReferenceBudget(ids: string[], artifacts: Map<string, ReferenceArtifact>): void {
  if (ids.length > ARTIFACT_REFERENCE_MAX_OCCURRENCES)
    throw new Error(`单条消息最多提及 ${ARTIFACT_REFERENCE_MAX_OCCURRENCES} 次 Artifact`)
  let chars = 0
  for (const id of new Set(ids)) {
    const artifact = artifacts.get(id)
    if (!artifact) throw new Error(ARTIFACT_REFERENCE_COPY.missing)
    chars += artifact.title.length + artifact.content.length
  }
  if (chars > ARTIFACT_REFERENCE_MAX_CHARS) throw new Error(ARTIFACT_REFERENCE_COPY.budget)
}

/** 每条消息独立去重，历史展开结果不随后续问题或引用变化。JSON 编码明确区分数据与边界。 */
export function artifactReferenceForModel(artifact: ReferenceArtifact, seen: Set<string>): string {
  const repeated = seen.has(artifact.id)
  seen.add(artifact.id)
  return JSON.stringify({
    contextType: "artifact-reference",
    artifactId: artifact.id,
    title: artifact.title,
    ...(repeated ? { previouslyIncludedInThisMessage: true } : {
      kind: artifact.kind,
      content: artifact.content,
    }),
  })
}

export function expandArtifactReferenceParts(
  parts: ThreadChatUIMessage["parts"],
  artifacts: Map<string, ReferenceArtifact>
): ThreadChatUIMessage["parts"] {
  const seen = new Set<string>()
  return parts.map((part) => {
    if (part.type !== "data-artifact-reference") return part
    const artifact = artifacts.get(artifactReferenceDataSchema.parse(part.data).artifactId)
    if (!artifact) throw new Error(ARTIFACT_REFERENCE_COPY.missing)
    return { type: "text" as const, text: artifactReferenceForModel(artifact, seen) }
  })
}
