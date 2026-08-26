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
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import { THREAD_TREE_SCHEMA_VERSION } from "@/constants/thread-chat"
import { selectDisplayTitle, selectVisibleMessages } from "./selectors"

function dataPart<T>(part: { type: string; data?: unknown }, type: string): T | null {
  return part.type === type ? (part.data as T) : null
}

function messageText(message: MessageDTO): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> =>
      part.type === "text"
    )
    .map((part) => part.text)
    .join("")
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
      threadId: thread.id,
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
  const status =
    message.status === "generating"
      ? message.parts.length === 0
        ? "pending"
        : "streaming"
      : message.status === "failed"
        ? "error"
        : "done"
  return {
    id: message.id,
    parentMessageId: input.parentMessageId,
    role: message.role,
    text: messageText(message),
    forks,
    status,
    ...(message.error ? { error: message.error.message } : {}),
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
    id: thread.id,
    modelId: thread.modelId,
    parentId: thread.parentId,
    depth: thread.depth,
    title: selectDisplayTitle(thread),
    anchorText: thread.anchorText,
    forkFromMsgId: thread.forkMessageId,
    footnote: thread.footnote,
    children: Object.values(state.threadsById)
      .filter((child) => child.parentId === thread.id)
      .sort((left, right) => (left.footnote ?? 0) - (right.footnote ?? 0))
      .map((child) => child.id),
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
    sourceThreadId:
      state.messagesById[artifact.sourceMessageId]?.threadId ?? "",
    sourceMessageId: artifact.sourceMessageId,
  }
}

/** Gate 3 兼容 facade：既有组件不再读取整树持久化，只消费规范化 selector 投影。 */
export function projectConversationTree(
  state: NormalizedThreadChatState
): ThreadTreeState {
  const threads = Object.fromEntries(
    Object.values(state.threadsById).map((thread) => [
      thread.id,
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
    recents: state.workspace.recents,
    footnoteCounter: Math.max(
      0,
      ...Object.values(state.threadsById).map((thread) => thread.footnote ?? 0)
    ),
    seq: Object.keys(state.messagesById).length,
    tick: state.workspace.recents.length,
  }
}

