import type {
  Artifact,
  ConversationViewMessage,
  Fork,
  Thread,
  ThreadTreeState,
} from "./types"
import type {
  ArtifactDTO,
  MessageDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { NormalizedThreadChatState } from "./types"
import type { MarkdownGenerationProgress } from "@/lib/thread-chat/domain/types"
import { textFromMessageParts } from "@/lib/thread-chat/contracts/ui-message"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import { THREAD_TREE_SCHEMA_VERSION } from "@/constants/thread-chat"
import { selectDisplayTitle, selectVisibleMessages } from "./selectors"
import { emptySeedState } from "./seed"

function dataPart<T>(
  part: { type: string; data?: unknown },
  type: string
): T | null {
  return part.type === type ? (part.data as T) : null
}

function messageText(message: MessageDTO): string {
  return textFromMessageParts(message.parts)
}

function projectMessageState(
  message: MessageDTO
): Pick<ConversationViewMessage, "status" | "error"> {
  switch (message.status) {
    case "generating":
      return { status: message.parts.length === 0 ? "pending" : "streaming" }
    case "completed":
      return { status: "done" }
    case "stopped":
      return { status: "stopped" }
    case "failed":
      return {
        status: "error",
        ...(message.error ? { error: message.error.message } : {}),
      }
  }
}

export function toConversationViewThreadId(
  state: NormalizedThreadChatState,
  threadId: string
): string {
  return state.project?.rootThreadId === threadId ? "main" : threadId
}

export function fromConversationViewThreadId(
  state: NormalizedThreadChatState,
  threadId: string
): string {
  return threadId === "main"
    ? (state.project?.rootThreadId ?? threadId)
    : threadId
}

export function projectMessageDTO(input: {
  message: MessageDTO
  state: NormalizedThreadChatState
  parentMessageId: string | null
}): ConversationViewMessage {
  const { message, state } = input
  const forks: Fork[] = Object.values(state.threadsById)
    .filter((thread) => thread.forkMessageId === message.id)
    .map((thread) => ({
      text: thread.anchorText ?? "",
      num: thread.footnote ?? 0,
      threadId: toConversationViewThreadId(state, thread.id),
      depth: thread.depth,
      ...(thread.forkAnchor ? { anchor: thread.forkAnchor } : {}),
    }))
  const activities = message.parts.flatMap((part) => {
    const value = dataPart<WebResearchActivity>(part, "data-research-activity")
    return value ? [value] : []
  })
  const route = message.parts
    .map((part) => dataPart<ResearchRoute>(part, "data-research-route"))
    .find((value): value is ResearchRoute => value !== null)
  const plan = message.parts
    .map((part) => dataPart<ResearchPlan>(part, "data-research-plan"))
    .find((value): value is ResearchPlan => value !== null)
  const progress = [...message.parts]
    .reverse()
    .map((part) =>
      dataPart<MarkdownGenerationProgress>(part, "data-artifact-progress")
    )
    .find((value): value is MarkdownGenerationProgress => value !== null)
  const quote = message.parts
    .map((part) => dataPart<{ text: string }>(part, "data-quote"))
    .find((value): value is { text: string } => value !== null)
  return {
    id: message.id,
    parentMessageId: input.parentMessageId,
    role: message.role,
    text: messageText(message),
    forks,
    ...projectMessageState(message),
    ...(quote ? { quote } : {}),
    ...(activities.length > 0 ? { webResearch: activities } : {}),
    ...(route ? { researchRoute: route } : {}),
    ...(plan ? { researchPlan: plan } : {}),
    ...(progress ? { markdownGeneration: progress } : {}),
    artifactIds: state.artifactOrder.filter(
      (id) => state.artifactsById[id]?.sourceMessageId === message.id
    ),
    backgroundGeneration:
      state.streamByMessageId[message.id]?.phase === "background",
    uiParts: message.parts,
  }
}

export function projectThreadDTO(
  state: NormalizedThreadChatState,
  thread: ThreadDTO
): Thread {
  const rows = selectVisibleMessages(state, thread.id)
  let parentMessageId: string | null = null
  const messages = rows.map((message) => {
    const projected = projectMessageDTO({ message, state, parentMessageId })
    parentMessageId = message.id
    return projected
  })
  return {
    id: toConversationViewThreadId(state, thread.id),
    modelId: thread.modelId,
    parentId:
      thread.parentId === null
        ? null
        : toConversationViewThreadId(state, thread.parentId),
    depth: thread.depth,
    title:
      thread.customTitle ??
      thread.autoTitle ??
      (thread.depth === 0
        ? "主线"
        : thread.anchorText
          ? thread.anchorText.length > 13
            ? `${thread.anchorText.slice(0, 13)}…`
            : thread.anchorText
          : selectDisplayTitle(thread)),
    anchorText: thread.anchorText,
    forkFromMsgId: thread.forkMessageId,
    footnote: thread.footnote,
    children: Object.values(state.threadsById)
      .filter((child) => child.parentId === thread.id)
      .sort((left, right) => (left.footnote ?? 0) - (right.footnote ?? 0))
      .map((child) => toConversationViewThreadId(state, child.id)),
    messages,
    activeLeafMessageId: messages.at(-1)?.id ?? null,
    lastActive: Math.max(0, state.workspace.recents.indexOf(thread.id) * -1),
    ...(thread.titleGenerationAttempted
      ? { titleGenerationAttempted: true as const }
      : {}),
    ...(thread.titleGenerated ? { titleGenerated: true as const } : {}),
  }
}

export function projectArtifactDTO(
  artifact: ArtifactDTO,
  state: NormalizedThreadChatState
): Artifact {
  return {
    id: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    ...(artifact.language ? { lang: artifact.language } : {}),
    content: artifact.content,
    sourceThreadId: toConversationViewThreadId(state, artifact.threadId),
    sourceMessageId: artifact.sourceMessageId,
  }
}

export function projectConversationTree(
  state: NormalizedThreadChatState
): ThreadTreeState {
  if (!state.project) return emptySeedState()
  const threads = Object.fromEntries(
    Object.values(state.threadsById).map((thread) => [
      toConversationViewThreadId(state, thread.id),
      projectThreadDTO(state, thread),
    ])
  )
  const artifacts = Object.fromEntries(
    state.artifactOrder.flatMap((id) => {
      const artifact = state.artifactsById[id]
      return artifact ? [[id, projectArtifactDTO(artifact, state)]] : []
    })
  )
  return {
    schemaVersion: THREAD_TREE_SCHEMA_VERSION,
    threads,
    artifacts,
    artifactOrder: state.artifactOrder.filter((id) => Boolean(artifacts[id])),
    recents: state.workspace.recents.map((threadId) =>
      toConversationViewThreadId(state, threadId)
    ),
    footnoteCounter: Math.max(
      0,
      ...Object.values(state.threadsById).map((thread) => thread.footnote ?? 0)
    ),
    seq: Object.keys(state.messagesById).length,
    tick: state.workspace.recents.length,
  }
}
