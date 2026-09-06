import { and, eq, inArray } from "drizzle-orm"
import { artifacts, messages } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"
import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  artifactReferenceData,
  assertArtifactReferenceBudget,
  type ReferenceArtifact,
} from "@/lib/thread-chat/contracts/artifact-reference"
import { messageContentToUiParts } from "@/lib/thread-chat/contracts/message-content"
import { ARTIFACT_REFERENCE_COPY } from "@/constants/artifact-reference"
import { notFound, stateConflict } from "./errors"

/** Project 是唯一范围边界；不限制当前 Thread、祖先或兄弟关系。 */
export async function loadReferenceArtifacts(
  executor: ConversationExecutor,
  projectId: string,
  ids: string[],
  requireCompleted = false
): Promise<Map<string, ReferenceArtifact>> {
  if (!ids.length) return new Map()
  const rows = await executor.select({ artifact: artifacts, status: messages.status })
    .from(artifacts)
    .innerJoin(messages, and(
      eq(messages.id, artifacts.sourceMessageId),
      eq(messages.projectId, artifacts.projectId),
      eq(messages.threadId, artifacts.threadId)
    ))
    .where(and(eq(artifacts.projectId, projectId), inArray(artifacts.id, [...new Set(ids)])))
  if (rows.length !== new Set(ids).size) notFound()
  if (requireCompleted && rows.some((row) => row.status !== "completed"))
    stateConflict(ARTIFACT_REFERENCE_COPY.incomplete)
  return new Map(rows.map(({ artifact }) => [artifact.id, artifact]))
}

export async function resolveUserMessageParts(
  executor: ConversationExecutor,
  projectId: string,
  content: MessageContentInput
): Promise<ThreadChatUIMessage["parts"]> {
  const ids = content.parts.flatMap((part) => part.type === "artifact-reference" ? [part.artifactId] : [])
  const resolved = await loadReferenceArtifacts(executor, projectId, ids, true)
  try { assertArtifactReferenceBudget(ids, resolved) }
  catch (error) { stateConflict(error instanceof Error ? error.message : ARTIFACT_REFERENCE_COPY.budget) }
  return messageContentToUiParts(content, (id) => artifactReferenceData(resolved.get(id)!))
}
