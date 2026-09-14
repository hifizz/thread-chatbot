import { documentContextForRequest } from "../domain/document-context-history"
import { restoreDocumentToolParts } from "../persistence/message-parts"
import { expandDocumentUpdates } from "./document-context"
import {
  artifactReferenceData,
  artifactReferenceDataSchema,
} from "../contracts/artifact-reference"
import {
  findOwnedArtifact,
  loadProjectReferenceArtifactRows,
} from "../persistence/artifact-repository"
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
  documentToolParts?: ThreadChatUIMessage["parts"]
}): ThreadChatUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: stripTransientParts(restoreDocumentToolParts(row.parts, row.documentToolParts)),
    metadata: { messageId: row.id, threadId: "context" },
  }
}

function hasArtifactReference(
  message: ThreadChatUIMessage,
  artifactId: string
): boolean {
  return message.parts.some((part) => {
    if (part.type !== "data-artifact-reference") return false
    const parsed = artifactReferenceDataSchema.safeParse(part.data)
    return parsed.success && parsed.data.artifactId === artifactId
  })
}

type OwnedThread = NonNullable<
  Awaited<ReturnType<typeof findOwnedThread>>
>

async function collectForkArtifactSources(
  userId: string,
  start: OwnedThread
): Promise<Array<{ artifactId: string; messageId: string }>> {
  const sources: Array<{ artifactId: string; messageId: string }> = []
  const visited = new Set<string>()
  let current: OwnedThread | null = start

  while (current) {
    if (visited.has(current.id)) stateConflict("Thread 父链存在循环")
    visited.add(current.id)
    if (current.forkArtifactId && current.forkMessageId) {
      sources.push({
        artifactId: current.forkArtifactId,
        messageId: current.forkMessageId,
      })
    }
    if (!current.parentId) break
    current = await findOwnedThread(db, userId, current.parentId)
    if (!current) stateConflict("Thread 父链不完整")
  }

  return sources.reverse()
}

async function includeForkArtifactsInFrozenHistory(input: {
  userId: string
  projectId: string
  sources: Array<{ artifactId: string; messageId: string }>
  messages: ThreadChatUIMessage[]
}): Promise<ThreadChatUIMessage[]> {
  if (!input.sources.length) return input.messages

  let messages = input.messages
  for (const source of input.sources) {
    const row = await findOwnedArtifact(db, input.userId, source.artifactId)
    if (!row) stateConflict("Artifact 分支来源不存在")
    const artifact = row.artifact
    if (
      artifact.projectId !== input.projectId ||
      artifact.sourceMessageId !== source.messageId ||
      artifact.kind !== "markdown"
    ) {
      stateConflict("Artifact 分支来源关系不完整")
    }

    let foundSource = false
    messages = messages.map((message) => {
      if (message.id !== source.messageId) return message
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
  }
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
  const forkArtifactSources = await collectForkArtifactSources(userId, thread)
  const inheritedMessages = await includeForkArtifactsInFrozenHistory({
    userId,
    projectId: thread.projectId,
    sources: forkArtifactSources,
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
  const activeUserId = currentRows.findLast((row) => row.role === "user" && row.supersededAt === null)?.id
  const selectDocumentContext = documentContextForRequest([...inheritedRows, ...currentRows], activeUserId)
  const uiMessages: ThreadChatUIMessage[] = [
    ...inheritedMessages,
    ...currentMessages,
  ].map(selectDocumentContext)
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
  const modelMessages = await convertToModelMessages(await expandDocumentUpdates(thread.projectId, expanded), {
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
