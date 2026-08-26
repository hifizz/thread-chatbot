/**
 * core/store —— 外部可变 store（zustand vanilla 风格，零依赖，纯 TS）。
 *
 * 模型：会话树对象身份稳定、原地修改；每次 mutate 后 version++ 并通知订阅者，
 * React 侧经 useSyncExternalStore 以 version 为快照触发重渲（见 use-thread-store.ts）。
 * 组件不允许直接改树，所有变更走这里的方法——这也是 demo 能通过
 * react-hooks/immutability 等规则的关键：mutation 全部收敛在非 React 代码里。
 */

import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type {
  ArtifactSeed,
  MarkdownGenerationProgress,
  Message,
  ThreadTreeState,
} from "./types"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import {
  mergeGenerationResult,
  type MergeGenerationResultInput,
} from "../generation/merge-result"
import type { PreparedTurnPatch } from "./regeneration"
import { createStore, type StoreApi } from "zustand/vanilla"
import type {
  ArtifactDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type {
  ConversationEntitySnapshot,
  ConversationStreamState,
  NormalizedThreadChatState,
  WorkspaceUiState,
} from "./types"

export interface ForkInput {
  /** 在哪个会话里划选的 */
  sourceThreadId: string
  /** 划选的是哪条消息 */
  sourceMsgId: string
  /** 被划选的原文（同时决定新会话标题与脚注锚点，= anchor.quote.exact） */
  anchorText: string
  /** 文本锚点：渲染后 Markdown DOM 上的模糊恢复定位依据（采集失败时可缺省） */
  anchor?: TextAnchor
}

export interface ForkResult {
  threadId: string
  title: string
}

/**
 * 分支的默认标题：锚点原文截 13 字（fork 时的初始标题；异步语义标题
 * 生成前 / 失败时的兜底展示，也是壳层判断「还没生成过标题」的比对基准）。
 */
export function defaultBranchTitle(anchorText: string): string {
  return anchorText.length > 13 ? anchorText.slice(0, 13) + "…" : anchorText
}

export type ThreadStore = ReturnType<typeof createThreadStore>

export function createThreadStore(
  seed: ThreadTreeState,
  isValidModelId: (modelId: string) => boolean = () => true
) {
  const state = seed
  let version = 0
  const listeners = new Set<() => void>()

  const notify = () => {
    version++
    listeners.forEach((fn) => fn())
  }

  /** 活跃计数 + 最近访问（供 LRU 放置与 ⌘K「最近访问」chips 使用），不发通知 */
  const touchSilently = (id: string) => {
    const t = state.threads[id]
    if (!t) return
    state.tick++
    t.lastActive = state.tick
    if (id !== "main")
      state.recents = [id, ...state.recents.filter((x) => x !== id)].slice(0, 6)
  }

  /** 登记一个 artifact（含 id 分配与 tab 顺序），不发通知 */
  const registerSilently = (
    sourceThreadId: string,
    sourceMessageId: string,
    seed_: ArtifactSeed
  ): string => {
    const id = "a" + state.seq++
    state.artifacts[id] = { id, sourceThreadId, sourceMessageId, ...seed_ }
    state.artifactOrder.push(id)
    return id
  }

  /** 从尾部反向查找消息（流式目标通常是最新消息，反向查找更快） */
  const findMessageFromTail = (
    messages: Message[],
    msgId: string
  ): Message | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].id === msgId) return messages[i]
    }
    return undefined
  }

  return {
    getState: () => state,
    getVersion: () => version,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },

    /** 标记某会话「刚被用过」：打开、发消息、被切换到时都要调 */
    touch(id: string) {
      touchSilently(id)
      notify()
    },

    /** 服务端已接受的生成 patch：一次通知内只追加节点并切换 head。 */
    applyPreparedTurn(patch: PreparedTurnPatch): boolean {
      const thread = state.threads[patch.threadId]
      if (!thread) return false
      const existingIds = new Set(thread.messages.map((message) => message.id))
      if (patch.addedMessages.some((message) => existingIds.has(message.id)))
        return false
      thread.messages.push(
        ...patch.addedMessages.map((message) => structuredClone(message))
      )
      thread.activeLeafMessageId = patch.nextActiveLeafMessageId
      touchSilently(patch.threadId)
      notify()
      return true
    },

    setActiveLeaf(threadId: string, assistantMessageId: string): boolean {
      const thread = state.threads[threadId]
      const target = thread?.messages.find(
        (message) =>
          message.id === assistantMessageId && message.role === "assistant"
      )
      if (!thread || !target) return false
      thread.activeLeafMessageId = target.id
      touchSilently(threadId)
      notify()
      return true
    },

    /** 从一条消息的划选文字上开出新分支；新分支消息为空，首条回复由 chat-controller 触发流式生成 */
    fork(input: ForkInput): ForkResult | null {
      const parent = state.threads[input.sourceThreadId]
      if (!parent) return null
      const srcMsg = parent.messages.find((m) => m.id === input.sourceMsgId)
      if (!srcMsg) return null

      state.footnoteCounter++
      const id = "b" + state.seq++
      const depth = parent.depth + 1
      const title = defaultBranchTitle(input.anchorText)

      state.threads[id] = {
        id,
        modelId: parent.modelId,
        parentId: input.sourceThreadId,
        depth,
        title,
        anchorText: input.anchorText,
        forkFromMsgId: input.sourceMsgId,
        footnote: state.footnoteCounter,
        children: [],
        messages: [],
        activeLeafMessageId: null,
        lastActive: 0,
      }
      parent.children.push(id)
      srcMsg.forks.push({
        text: input.anchorText,
        num: state.footnoteCounter,
        threadId: id,
        depth,
        anchor: input.anchor,
      })

      notify()
      return { threadId: id, title }
    },

    /** 追加一条用户消息；返回消息 id，会话不存在时返回 null */
    appendUserMessage(
      threadId: string,
      text: string,
      quote?: { text: string }
    ): string | null {
      const t = state.threads[threadId]
      if (!t) return null
      const id = "m" + state.seq++
      t.messages.push({
        id,
        parentMessageId: t.activeLeafMessageId,
        role: "user",
        text,
        forks: [],
        ...(quote ? { quote } : {}),
      })
      t.activeLeafMessageId = id
      touchSilently(threadId)
      notify()
      return id
    },

    /** 新建一条 pending 的空 assistant 消息（流式回复的占位），返回消息 id */
    beginAssistantMessage(
      threadId: string,
      generationId?: string
    ): string | null {
      const t = state.threads[threadId]
      if (!t) return null
      const id = "m" + state.seq++
      t.messages.push({
        id,
        parentMessageId: t.activeLeafMessageId,
        role: "assistant",
        text: "",
        forks: [],
        generationId,
        backgroundGeneration: undefined,
        status: "pending",
      })
      t.activeLeafMessageId = id
      notify()
      return id
    },

    /** 给流式中的 assistant 消息追加一段文本增量 */
    appendAssistantDelta(threadId: string, msgId: string, delta: string): void {
      const t = state.threads[threadId]
      if (!t) return
      const msg = findMessageFromTail(t.messages, msgId)
      if (!msg) return
      msg.text += delta
      msg.status = "streaming"
      notify()
    },

    /** 更新 Markdown 工具的临时生成进度；完整 Artifact 到达后会被原子清除。 */
    setMarkdownGenerationProgress(
      threadId: string,
      msgId: string,
      progress: MarkdownGenerationProgress
    ): void {
      const t = state.threads[threadId]
      if (!t) return
      const msg = findMessageFromTail(t.messages, msgId)
      if (!msg || msg.role !== "assistant") return
      if (msg.status === "done" || msg.status === "error") return
      msg.markdownGeneration = progress
      msg.status = "streaming"
      notify()
    },

    /** 聚合联网搜索/深读状态；同一 toolCallId 原位更新，保持真实调用顺序。 */
    setWebResearchActivity(
      threadId: string,
      msgId: string,
      activity: WebResearchActivity
    ): void {
      const thread = state.threads[threadId]
      if (!thread) return
      const message = findMessageFromTail(thread.messages, msgId)
      if (!message || message.role !== "assistant") return
      if (message.status === "done" || message.status === "error") return

      const activities = message.webResearch ?? []
      if (message.webResearchTextOffset == null)
        message.webResearchTextOffset = message.text.length
      const index = activities.findIndex(
        (item) => item.toolCallId === activity.toolCallId
      )
      if (index === -1) activities.push(activity)
      else activities[index] = { ...activities[index], ...activity }
      message.webResearch = activities
      message.status = "streaming"
      notify()
    },

    /** 保存本轮联网路由决策；普通 answer 路由不改变可见状态。 */
    setResearchRoute(
      threadId: string,
      msgId: string,
      route: ResearchRoute
    ): void {
      const thread = state.threads[threadId]
      if (!thread) return
      const message = findMessageFromTail(thread.messages, msgId)
      if (!message || message.role !== "assistant") return
      if (message.status === "done" || message.status === "error") return
      message.researchRoute = route
      notify()
    },

    /** 保存复杂研究的可审计计划摘要，不保存或展示模型原始思维链。 */
    setResearchPlan(threadId: string, msgId: string, plan: ResearchPlan): void {
      const thread = state.threads[threadId]
      if (!thread) return
      const message = findMessageFromTail(thread.messages, msgId)
      if (!message || message.role !== "assistant") return
      if (message.status === "done" || message.status === "error") return
      message.researchPlan = plan
      message.status = "streaming"
      notify()
    },

    /** 流式结束：标记消息完成 */
    finishAssistantMessage(threadId: string, msgId: string): void {
      const t = state.threads[threadId]
      if (!t) return
      const msg = findMessageFromTail(t.messages, msgId)
      if (!msg) return
      msg.markdownGeneration = undefined
      msg.webResearch = msg.webResearch?.map((activity) => ({
        ...activity,
        status: "complete",
      }))
      msg.status = "done"
      touchSilently(threadId)
      notify()
    },

    /** 流式失败：标记错误（已收到的文本保留） */
    failAssistantMessage(
      threadId: string,
      msgId: string,
      message: string
    ): void {
      const t = state.threads[threadId]
      if (!t) return
      const msg = findMessageFromTail(t.messages, msgId)
      if (!msg) return
      msg.markdownGeneration = undefined
      msg.webResearch = msg.webResearch?.map((activity) => ({
        ...activity,
        status: "complete",
      }))
      msg.status = "error"
      msg.error = message
      notify()
    },

    /** 轮询/加载终态的 generationId CAS 合并；旧 attempt 返回 false 且零写入。 */
    applyGenerationResult(input: MergeGenerationResultInput): boolean {
      const merged = mergeGenerationResult(state, input)
      if (merged === state) return false
      Object.assign(state, merged)
      notify()
      return true
    },

    /**
     * 写入模型成功生成的语义标题。成功状态与“已尝试”分离：主线失败时继续使用
     * 首条消息派生的回退标题。更新随整树防抖存盘，列头和会话列表同步重渲。
     */
    setGeneratedThreadTitle(threadId: string, title: string): void {
      const t = state.threads[threadId]
      if (!t) return
      const v = title.trim()
      if (!v || (t.title === v && t.titleGenerated)) return
      t.title = v
      t.titleGenerated = true
      notify()
    },

    /**
     * 原子记录一次主线或分支自动标题生成尝试。该标记随整棵树持久化，失败也不在
     * 刷新后重试，以避免可选功能反复消耗模型配额。
     */
    markTitleGenerationAttempted(threadId: string): boolean {
      const t = state.threads[threadId]
      if (!t || t.titleGenerationAttempted) return false
      t.titleGenerationAttempted = true
      notify()
      return true
    },

    /** MVP 模型策略：仅根 Thread 可切换；分支由 fork 继承且保持锁定。 */
    setThreadModel(threadId: string, modelId: string): void {
      const thread = state.threads[threadId]
      if (
        !thread ||
        thread.parentId !== null ||
        !isValidModelId(modelId) ||
        thread.modelId === modelId
      )
        return
      thread.modelId = modelId
      notify()
    },

    /** 单独登记一个 artifact（fork 之外的入口，预留） */
    registerArtifact(
      sourceThreadId: string,
      sourceMessageId: string,
      seed_: ArtifactSeed
    ): string {
      const id = registerSilently(sourceThreadId, sourceMessageId, seed_)
      notify()
      return id
    },

    /** 原子登记 artifact 并绑定到产生它的 assistant 消息；目标无效时零写入。 */
    attachArtifactToMessage(
      threadId: string,
      messageId: string,
      seed_: ArtifactSeed
    ): string | null {
      const thread = state.threads[threadId]
      if (!thread) return null
      const message = findMessageFromTail(thread.messages, messageId)
      if (!message || message.role !== "assistant") return null
      const id = registerSilently(threadId, messageId, seed_)
      message.artifactIds = [...(message.artifactIds ?? []), id]
      message.markdownGeneration = undefined
      // 完整工具输入已经到达：即使尚无正文，也不再显示 pending 三点占位。
      if (message.status === "pending") message.status = "streaming"
      notify()
      return id
    },
  }
}

export type ConversationStore = StoreApi<NormalizedThreadChatState>

const EMPTY_WORKSPACE: WorkspaceUiState = {
  view: "columns",
  openThreadIds: [],
  selectedThreadId: "",
  recents: [],
  canvas: { pins: {} },
  panelSizes: {},
  expandedNodes: [],
}

function orderedMessageIds(messages: MessageDTO[]): Record<string, string[]> {
  const byThread: Record<string, MessageDTO[]> = {}
  for (const message of messages) {
    ;(byThread[message.threadId] ??= []).push(message)
  }
  return Object.fromEntries(
    Object.entries(byThread).map(([threadId, rows]) => [
      threadId,
      rows.sort((left, right) => left.sequence - right.sequence).map((row) => row.id),
    ])
  )
}

function streamState(phase: ConversationStreamState["phase"]): ConversationStreamState {
  return { phase, lastEventSeq: 0, pollAttempt: 0 }
}

function entitiesFromBootstrap(
  bootstrap: ProjectBootstrapDTO
): ConversationEntitySnapshot {
  const active = new Set(bootstrap.activeGenerationIds)
  return {
    project: bootstrap.project,
    threadsById: Object.fromEntries(bootstrap.threads.map((thread) => [thread.id, thread])),
    messagesById: Object.fromEntries(
      bootstrap.messages.map((message) => [message.id, message])
    ),
    messageIdsByThread: orderedMessageIds(bootstrap.messages),
    artifactsById: Object.fromEntries(
      bootstrap.artifacts.map((artifact) => [artifact.id, artifact])
    ),
    artifactOrder: bootstrap.artifacts.map((artifact) => artifact.id),
    streamByMessageId: Object.fromEntries(
      bootstrap.messages
        .filter((message) => active.has(message.id))
        .map((message) => [message.id, streamState("background")])
    ),
  }
}

function emptyEntities(): ConversationEntitySnapshot {
  return entitiesFromBootstrap({
    project: null,
    threads: [],
    messages: [],
    artifacts: [],
    activeGenerationIds: [],
  })
}

function entitySnapshot(
  state: NormalizedThreadChatState
): ConversationEntitySnapshot {
  return structuredClone({
    project: state.project,
    threadsById: state.threadsById,
    messagesById: state.messagesById,
    messageIdsByThread: state.messageIdsByThread,
    artifactsById: state.artifactsById,
    artifactOrder: state.artifactOrder,
    streamByMessageId: state.streamByMessageId,
  })
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function rollbackRecord<T>(
  current: Record<string, T>,
  before: Record<string, T>,
  after: Record<string, T>
): Record<string, T> {
  const result = { ...current }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameValue(before[key], after[key])) continue
    if (!sameValue(current[key], after[key])) continue
    if (before[key] === undefined) delete result[key]
    else result[key] = structuredClone(before[key])
  }
  return result
}

function insertMessageId(
  current: string[] | undefined,
  message: MessageDTO,
  messagesById: Record<string, MessageDTO>
): string[] {
  const ids = current?.includes(message.id)
    ? [...current]
    : [...(current ?? []), message.id]
  return ids.sort(
    (left, right) =>
      (left === message.id ? message : messagesById[left])!.sequence -
      (right === message.id ? message : messagesById[right])!.sequence
  )
}

export function createConversationStore(input?: {
  bootstrap?: ProjectBootstrapDTO
  workspace?: Partial<WorkspaceUiState>
}): ConversationStore {
  const initial = input?.bootstrap
    ? entitiesFromBootstrap(input.bootstrap)
    : emptyEntities()
  return createStore<NormalizedThreadChatState>()((set, get) => ({
    ...initial,
    optimisticByCommandId: {},
    workspace: {
      ...structuredClone(EMPTY_WORKSPACE),
      ...input?.workspace,
    },
    hydrateProject(bootstrap) {
      set({
        ...entitiesFromBootstrap(bootstrap),
        optimisticByCommandId: {},
      })
    },
    upsertProject(project: ProjectDTO) {
      set({ project })
    },
    upsertThread(thread: ThreadDTO) {
      set((state) => ({
        threadsById: { ...state.threadsById, [thread.id]: thread },
      }))
    },
    upsertMessage(message: MessageDTO) {
      set((state) => {
        const messagesById = { ...state.messagesById, [message.id]: message }
        return {
          messagesById,
          messageIdsByThread: {
            ...state.messageIdsByThread,
            [message.threadId]: insertMessageId(
              state.messageIdsByThread[message.threadId],
              message,
              messagesById
            ),
          },
        }
      })
    },
    upsertArtifact(artifact: ArtifactDTO) {
      set((state) => ({
        artifactsById: { ...state.artifactsById, [artifact.id]: artifact },
        artifactOrder: state.artifactOrder.includes(artifact.id)
          ? state.artifactOrder
          : [...state.artifactOrder, artifact.id],
      }))
    },
    applyStreamSnapshot(messageId, message, throughSeq) {
      set((state) => {
        const current = state.streamByMessageId[messageId]
        if (current && throughSeq < current.lastEventSeq) return state
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: {
              phase: "live",
              liveMessage: structuredClone(message),
              lastEventSeq: throughSeq,
              pollAttempt: 0,
            },
          },
        }
      })
    },
    applyStreamChunk(messageId, message, seq) {
      set((state) => {
        const current = state.streamByMessageId[messageId]
        if (current && seq <= current.lastEventSeq) return state
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: {
              phase: "live",
              liveMessage: structuredClone(message),
              lastEventSeq: seq,
              pollAttempt: 0,
            },
          },
        }
      })
    },
    markBackgroundGeneration(messageId) {
      set((state) => {
        const current = state.streamByMessageId[messageId] ?? streamState("background")
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: { ...current, phase: "background" },
          },
        }
      })
    },
    mergePolledMessage(message) {
      if (message.status !== "generating") {
        get().reconcileTerminalMessage(message)
        return
      }
      set((state) => {
        const existing = state.messagesById[message.id]
        if (
          existing &&
          Date.parse(existing.updatedAt) > Date.parse(message.updatedAt)
        )
          return state
        const messagesById = { ...state.messagesById, [message.id]: message }
        const stream = state.streamByMessageId[message.id]
        return {
          messagesById,
          messageIdsByThread: {
            ...state.messageIdsByThread,
            [message.threadId]: insertMessageId(
              state.messageIdsByThread[message.threadId],
              message,
              messagesById
            ),
          },
          streamByMessageId: {
            ...state.streamByMessageId,
            [message.id]: {
              ...(stream ?? streamState("background")),
              phase: "background",
              pollAttempt: (stream?.pollAttempt ?? 0) + 1,
            },
          },
        }
      })
    },
    reconcileTerminalMessage(message) {
      set((state) => {
        const messagesById = { ...state.messagesById, [message.id]: message }
        return {
          messagesById,
          messageIdsByThread: {
            ...state.messageIdsByThread,
            [message.threadId]: insertMessageId(
              state.messageIdsByThread[message.threadId],
              message,
              messagesById
            ),
          },
          streamByMessageId: {
            ...state.streamByMessageId,
            [message.id]: {
              phase: "terminal",
              lastEventSeq:
                state.streamByMessageId[message.id]?.lastEventSeq ?? 0,
              pollAttempt: 0,
            },
          },
        }
      })
    },
    beginOptimisticCommand(commandId, apply) {
      set((state) => {
        if (state.optimisticByCommandId[commandId]) return state
        const before = entitySnapshot(state)
        const partial = apply(before)
        const after = { ...before, ...structuredClone(partial) }
        return {
          ...partial,
          optimisticByCommandId: {
            ...state.optimisticByCommandId,
            [commandId]: { commandId, before, after },
          },
        }
      })
    },
    commitOptimisticCommand(commandId) {
      set((state) => {
        if (!state.optimisticByCommandId[commandId]) return state
        const optimisticByCommandId = { ...state.optimisticByCommandId }
        delete optimisticByCommandId[commandId]
        return { optimisticByCommandId }
      })
    },
    rollbackOptimisticCommand(commandId) {
      set((state) => {
        const patch = state.optimisticByCommandId[commandId]
        if (!patch) return state
        const optimisticByCommandId = { ...state.optimisticByCommandId }
        delete optimisticByCommandId[commandId]
        const current = entitySnapshot(state)
        return {
          project:
            !sameValue(patch.before.project, patch.after.project) &&
            sameValue(current.project, patch.after.project)
              ? structuredClone(patch.before.project)
              : current.project,
          threadsById: rollbackRecord(
            current.threadsById,
            patch.before.threadsById,
            patch.after.threadsById
          ),
          messagesById: rollbackRecord(
            current.messagesById,
            patch.before.messagesById,
            patch.after.messagesById
          ),
          messageIdsByThread: rollbackRecord(
            current.messageIdsByThread,
            patch.before.messageIdsByThread,
            patch.after.messageIdsByThread
          ),
          artifactsById: rollbackRecord(
            current.artifactsById,
            patch.before.artifactsById,
            patch.after.artifactsById
          ),
          artifactOrder:
            !sameValue(patch.before.artifactOrder, patch.after.artifactOrder) &&
            sameValue(current.artifactOrder, patch.after.artifactOrder)
              ? structuredClone(patch.before.artifactOrder)
              : current.artifactOrder,
          streamByMessageId: rollbackRecord(
            current.streamByMessageId,
            patch.before.streamByMessageId,
            patch.after.streamByMessageId
          ),
          optimisticByCommandId,
        }
      })
    },
    removeProject(projectId) {
      set((state) =>
        state.project?.id === projectId
          ? { ...emptyEntities(), optimisticByCommandId: {} }
          : state
      )
    },
    setWorkspace(next) {
      set((state) => ({ workspace: { ...state.workspace, ...next } }))
    },
  }))
}
