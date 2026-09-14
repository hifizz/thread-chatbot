import { artifactReferenceData, artifactReferenceDataSchema } from "../contracts/artifact-reference"
import { findOwnedArtifact, loadProjectReferenceArtifactRows } from "../persistence/artifact-repository"
import { expandArtifactReferencesInContext } from "./artifact-reference-context"
import { convertToModelMessages, type ModelMessage } from "ai"
import { db } from "@/lib/db"
import { supportsModelImageInput } from "@/constants/model"
import {
  applyImageFileMaterializations,
  resolveAttachmentContext,
  type ProjectFileContextStats,
} from "@/lib/chat/resolve-attachments"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  persistedThreadQuotePartSchema,
  quoteForModel,
} from "@/lib/thread-chat/contracts/quote"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import {
  loadProjectMessagesByIds,
  listThreadMessageRows,
} from "@/lib/thread-chat/persistence/message-repository"
import { listProjectFileRows } from "@/lib/thread-chat/persistence/project-file-repository"
import { findOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"

function asUiMessage(row: {
  id: string
  role: "user" | "assistant"
  parts: ThreadChatUIMessage["parts"]
}): ThreadChatUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: stripTransientParts(row.parts),
    metadata: { messageId: row.id, threadId: "context" },
  }
}

function hasArtifactReference(
  message: ThreadChatUIMessage,
  artifactId: string
): boolean {
  return message.parts.some(
    (part) =>
      part.type === "data-artifact-reference" &&
      artifactReferenceDataSchema.safeParse(part.data).data?.artifactId === artifactId
  )
}

async function includeForkArtifactInFrozenHistory(input: {
  userId: string
  projectId: string
  forkArtifactId: string | null
  forkMessageId: string | null
  messages: ThreadChatUIMessage[]
}): Promise<ThreadChatUIMessage[]> {
  if (!input.forkArtifactId || !input.forkMessageId) return input.messages

  const row = await findOwnedArtifact(db, input.userId, input.forkArtifactId)
  if (!row) stateConflict("Artifact 分支来源不存在")
  const artifact = row.artifact
  if (
    artifact.projectId !== input.projectId ||
    artifact.sourceMessageId !== input.forkMessageId ||
    artifact.kind !== "markdown"
  ) {
    stateConflict("Artifact 分支来源关系不完整")
  }

  let foundSource = false
  const messages = input.messages.map((message) => {
    if (message.id !== input.forkMessageId) return message
    foundSource = true
    if (hasArtifactReference(message, artifact.id)) return message
    return {
      ...message,
      parts: [
        ...message.parts,
        {
          type: "data-artifact-reference" as const,
          data: artifactReferenceData(artifact),
        },
      ],
    }
  })
  if (!foundSource) stateConflict("Artifact 分支的冻结来源消息不完整")
  return messages
}

export interface CompiledModelContext {
  messages: ModelMessage[]
  boundaries: {
    stableInstructionsEnd: true
    stableHistoryMessageIndex: number | null
  }
  projectFileIds: string[]
  projectFileStats: ProjectFileContextStats
}

/** 返回模型消息与本轮固定的 Project File 快照。 */
export async function compileModelContextWithProject({
  userId,
  threadId,
  modelId,
  excludeAssistantMessageId,
}: {
  userId: string
  threadId: string
  modelId: string
  excludeAssistantMessageId?: string
}): Promise<CompiledModelContext> {
  const thread = await findOwnedThread(db, userId, threadId)
  if (!thread) notFound()
  const inheritedRows = await loadProjectMessagesByIds(
    db,
    thread.projectId,
    thread.forkContext
  )
  const byId = new Map(inheritedRows.map((message) => [message.id, message]))
  const inherited = thread.forkContext.map((id) => byId.get(id))
  if (inherited.some((message) => !message)) {
    stateConflict("冻结分支上下文不完整")
  }
  const inheritedMessages = await includeForkArtifactInFrozenHistory({
    userId,
    projectId: thread.projectId,
    forkArtifactId: thread.forkArtifactId,
    forkMessageId: thread.forkMessageId,
    messages: inherited.map((row) => asUiMessage(row!)),
  })
  const currentRows = await listThreadMessageRows(
    db,
    thread.projectId,
    thread.id
  )
  const currentMessages = currentRows
    .filter(
      (message) =>
        message.supersededAt === null &&
        message.id !== excludeAssistantMessageId
    )
    .map(asUiMessage)
  const uiMessages: ThreadChatUIMessage[] = [
    ...inheritedMessages,
    ...currentMessages,
  ]
  const projectFiles = await listProjectFileRows(db, thread.projectId)
  const resolved = await resolveAttachmentContext({
    messages: uiMessages,
    userId,
    projectFiles,
    supportsImageInput: supportsModelImageInput(modelId),
  })
  const withProjectContext: ThreadChatUIMessage[] = [
    ...(resolved.projectContext
      ? [
          {
            id: "project-files-context",
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: resolved.projectContext,
              },
            ],
            metadata: {
              messageId: "project-files-context",
              threadId: thread.id,
            },
          },
        ]
      : []),
    // resolveAttachmentContext only rewrites message parts and preserves the
    // original UI message identity/metadata. Its shared attachment API remains
    // generic UIMessage-shaped, so restore the narrower ThreadChat type here.
    ...(resolved.messages as ThreadChatUIMessage[]),
  ]
  const referenceIds = withProjectContext.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "data-artifact-reference"
        ? [artifactReferenceDataSchema.parse(part.data).artifactId]
        : []
    )
  )
  const referenceRows = await loadProjectReferenceArtifactRows(
    db,
    thread.projectId,
    referenceIds
  )
  if (referenceRows.length !== new Set(referenceIds).size)
    stateConflict("Artifact 引用目标不完整")
  const expanded = expandArtifactReferencesInContext(
    withProjectContext,
    new Map(referenceRows.map(({ artifact }) => [artifact.id, artifact]))
  )
  const modelMessages = await convertToModelMessages(expanded, {
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) => {
      if (part.type !== "data-quote") return undefined
      const parsed = persistedThreadQuotePartSchema.safeParse(part)
      if (!parsed.success) return undefined
      const quote = quoteForModel(parsed.data.data)
      const text = quote.comment
        ? `<quote>\n${quote.text}\n</quote>\n<comment>${quote.comment}</comment>`
        : `<quote>\n${quote.text}\n</quote>`
      return { type: "text", text }
    },
  })
  return {
    messages: applyImageFileMaterializations(
      modelMessages,
      resolved.imageFiles
    ),
    boundaries: {
      stableInstructionsEnd: true,
      stableHistoryMessageIndex:
        modelMessages.length > 1 ? modelMessages.length - 2 : null,
    },
    projectFileIds: resolved.projectFileIds,
    projectFileStats: resolved.stats,
  }
}

/** 兼容现有调用方：只返回纯模型消息。 */
export async function compileModelContext(input: {
  userId: string
  threadId: string
  modelId: string
  excludeAssistantMessageId?: string
}): Promise<ModelMessage[]> {
  return (await compileModelContextWithProject(input)).messages
}
