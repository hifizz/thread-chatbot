import { invariant } from "./domain-error"
import type { ArtifactId, MessageId, ProjectId } from "./ids"
import type { Message } from "./message"
import type { Thread } from "./thread"

export type Artifact = {
  id: ArtifactId
  projectId: ProjectId
  sourceMessageId: MessageId
  changeSequence: number
  kind: string
  title: string
  content: unknown
  createdAt: Date
}

export type MarkdownArtifactToolOutput = { artifactId: ArtifactId }

export function assertArtifactProvenance(
  artifact: Pick<Artifact, "projectId" | "sourceMessageId">,
  sourceMessage: Message,
  sourceThread: Thread
): void {
  invariant(
    sourceMessage.id === artifact.sourceMessageId &&
      sourceMessage.threadId === sourceThread.id &&
      sourceThread.projectId === artifact.projectId,
    "artifact_provenance_invalid",
    "Artifact source Message 必须属于同一 Project。"
  )
}

export function toMarkdownArtifactToolOutput(
  artifact: Pick<Artifact, "id">
): MarkdownArtifactToolOutput {
  return { artifactId: artifact.id }
}
