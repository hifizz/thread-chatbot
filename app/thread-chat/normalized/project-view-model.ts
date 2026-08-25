import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/model"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type { ThreadChatProjectStore } from "@/lib/thread-chat/client/types"
import type {
  Artifact,
  Message,
  MessageStatus,
  Thread,
  ThreadTreeState,
} from "../core/types"

type LoosePart = {
  type?: unknown
  text?: unknown
  input?: unknown
  output?: unknown
}

export interface ArtifactHint {
  id: string
  title: string
  kind: "markdown"
  sourceThreadId?: string
  sourceMessageId?: string
}

export function withThreadModel(
  state: ThreadTreeState,
  threadId: string,
  modelId: string
): ThreadTreeState {
  const thread = state.threads[threadId]
  if (!thread || thread.modelId === modelId) return state
  return {
    ...state,
    threads: {
      ...state.threads,
      [threadId]: { ...thread, modelId },
    },
  }
}

export function textFromParts(parts: readonly unknown[] | null | undefined) {
  return (parts ?? [])
    .flatMap((part) => {
      const candidate = part as LoosePart
      return candidate.type === "text" && typeof candidate.text === "string"
        ? [candidate.text]
        : []
    })
    .join("")
}

export function artifactHintsFromParts(
  parts: readonly unknown[] | null | undefined
): ArtifactHint[] {
  const hints = new Map<string, ArtifactHint>()
  for (const part of parts ?? []) {
    const candidate = part as LoosePart
    if (candidate.type !== "dynamic-tool") continue
    const output = candidate.output as { artifactId?: unknown } | undefined
    if (typeof output?.artifactId !== "string") continue
    const input = candidate.input as { title?: unknown } | undefined
    hints.set(output.artifactId, {
      id: output.artifactId,
      title:
        typeof input?.title === "string" && input.title.trim()
          ? input.title.trim()
          : "Markdown",
      kind: "markdown",
    })
  }
  return [...hints.values()]
}

function displayTitle(value: string | null | undefined, fallback: string) {
  const title = value?.trim()
  return title ? title : fallback
}

function artifactContent(content: unknown): string {
  if (typeof content === "string") return content
  return JSON.stringify(content, null, 2)
}

function statusOf(
  state: ThreadChatProjectStore,
  messageId: string,
  text: string
): { status?: MessageStatus; error?: string; backgroundGeneration?: boolean } {
  const run = state.runs.byAssistantMessageId[messageId]
  if (!run)
    return state.entities.messagesById[messageId]?.finalizedAt
      ? { status: "done" }
      : { status: "pending" }
  if (run.status === "queued") return { status: "pending" }
  if (run.status === "running")
    return { status: "streaming", backgroundGeneration: true }
  if (run.status === "completed" || (run.status === "stopped" && text))
    return { status: "done" }
  return {
    status: "error",
    error:
      run.error?.message ??
      (run.status === "stopped" ? "生成已停止" : "生成失败"),
  }
}

function threadDepths(state: ThreadChatProjectStore) {
  const memo = new Map<string, number>()
  const visit = (threadId: string, path = new Set<string>()): number => {
    const known = memo.get(threadId)
    if (known !== undefined) return known
    if (path.has(threadId)) return 0
    const thread = state.entities.threadsById[threadId]
    if (!thread?.parentThreadId) {
      memo.set(threadId, 0)
      return 0
    }
    const nextPath = new Set(path).add(threadId)
    const depth = visit(thread.parentThreadId, nextPath) + 1
    memo.set(threadId, depth)
    return depth
  }
  for (const threadId of Object.keys(state.entities.threadsById))
    visit(threadId)
  return memo
}

function branchFootnotes(state: ThreadChatProjectStore) {
  const ordered = Object.values(state.entities.threadsById)
    .filter((thread) => thread.parentThreadId !== null)
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    )
  return new Map(ordered.map((thread, index) => [thread.id, index + 1]))
}

function modelForThread(state: ThreadChatProjectStore, threadId: string) {
  const ids = state.entities.messageIdsByThreadId[threadId] ?? []
  for (let index = ids.length - 1; index >= 0; index--) {
    const run = state.runs.byAssistantMessageId[ids[index]]
    if (run?.modelId) return run.modelId
  }
  return DEFAULT_THREAD_CHAT_MODEL_ID
}

function sourceAnchor(quote: string | undefined): TextAnchor | undefined {
  return quote ? { quote: { exact: quote, prefix: "", suffix: "" } } : undefined
}

export function projectLegacyTreeView(
  state: ThreadChatProjectStore
): ThreadTreeState {
  const depths = threadDepths(state)
  const footnotes = branchFootnotes(state)
  const childrenByParent = new Map<string, string[]>()
  for (const thread of Object.values(state.entities.threadsById)) {
    if (!thread.parentThreadId) continue
    const children = childrenByParent.get(thread.parentThreadId) ?? []
    children.push(thread.id)
    childrenByParent.set(thread.parentThreadId, children)
  }
  for (const children of childrenByParent.values())
    children.sort((left, right) => {
      const leftThread = state.entities.threadsById[left]
      const rightThread = state.entities.threadsById[right]
      return (
        leftThread.createdAt.localeCompare(rightThread.createdAt) ||
        left.localeCompare(right)
      )
    })

  const artifactHints = new Map<string, ArtifactHint>()
  const threads: Record<string, Thread> = {}
  for (const entity of Object.values(state.entities.threadsById)) {
    const ids = state.entities.messageIdsByThreadId[entity.id] ?? []
    const visible = ids
      .map((id) => state.entities.messagesById[id])
      .filter(
        (message) =>
          Boolean(message) &&
          message.supersededAt === null &&
          !state.readModels.replacementSupersededMessageIds[message.id]
      )
    const childThreads = (childrenByParent.get(entity.id) ?? []).map(
      (id) => state.entities.threadsById[id]
    )
    const messages: Message[] = visible.map((entityMessage, index) => {
      const run = state.runs.byAssistantMessageId[entityMessage.id]
      const persistedText = textFromParts(entityMessage.parts)
      const checkpointText = textFromParts(run?.checkpointParts)
      const text = persistedText || checkpointText
      const hints = artifactHintsFromParts(
        entityMessage.parts ?? run?.checkpointParts
      )
      for (const hint of hints)
        artifactHints.set(hint.id, {
          ...hint,
          sourceThreadId: entityMessage.threadId,
          sourceMessageId: entityMessage.id,
        })
      const forks = childThreads
        .filter((child) => child.sourceMessageId === entityMessage.id)
        .map((child) => ({
          text: child.forkSourceSnapshot?.quote ?? "",
          num: footnotes.get(child.id) ?? 0,
          threadId: child.id,
          depth: depths.get(child.id) ?? 1,
          anchor: sourceAnchor(child.forkSourceSnapshot?.quote),
        }))
      return {
        id: entityMessage.id,
        parentMessageId: index === 0 ? null : visible[index - 1].id,
        role: entityMessage.role,
        text,
        forks,
        ...(entityMessage.role === "assistant"
          ? {
              generationId: entityMessage.id,
              artifactIds: hints.map((hint) => hint.id),
              ...statusOf(state, entityMessage.id, text),
            }
          : index === 0 && entity.parentThreadId
            ? {
                quote: entity.forkSourceSnapshot?.quote
                  ? { text: entity.forkSourceSnapshot.quote }
                  : undefined,
              }
            : null),
      }
    })
    const quote = entity.forkSourceSnapshot?.quote ?? null
    threads[entity.id] = {
      id: entity.id,
      modelId: modelForThread(state, entity.id),
      parentId: entity.parentThreadId,
      depth: depths.get(entity.id) ?? 0,
      title:
        entity.parentThreadId === null
          ? "主线"
          : displayTitle(
              entity.customTitle ?? entity.autoTitle,
              quote ?? "新分支"
            ),
      anchorText: quote,
      forkFromMsgId: entity.sourceMessageId,
      footnote: footnotes.get(entity.id) ?? null,
      children: childrenByParent.get(entity.id) ?? [],
      messages,
      activeLeafMessageId: messages.at(-1)?.id ?? null,
      lastActive:
        state.ui.lastActivatedOrderBySlotId[
          state.ui.columnSlots.find((slot) => slot.threadId === entity.id)
            ?.slotId ?? "root"
        ] ?? 0,
    }
  }

  const artifacts: Record<string, Artifact> = {}
  for (const hint of artifactHints.values()) {
    const loaded = state.entities.artifactsById[hint.id]
    const sourceMessage = loaded
      ? state.entities.messagesById[loaded.sourceMessageId]
      : undefined
    artifacts[hint.id] = {
      id: hint.id,
      title: loaded?.title ?? hint.title,
      kind:
        loaded?.kind === "code" || loaded?.kind === "note"
          ? loaded.kind
          : "markdown",
      content: loaded ? artifactContent(loaded.content) : "",
      sourceThreadId: sourceMessage?.threadId ?? hint.sourceThreadId ?? "",
      sourceMessageId: loaded?.sourceMessageId ?? hint.sourceMessageId ?? "",
    }
  }

  return {
    schemaVersion: 2,
    threads,
    artifacts,
    artifactOrder: [...artifactHints.keys()],
    recents: state.ui.columnSlots.map((slot) => slot.threadId).toReversed(),
    footnoteCounter: footnotes.size,
    seq: 1,
    tick: state.ui.activationClock,
  }
}
