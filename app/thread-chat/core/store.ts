/**
 * core/store —— 外部可变 store（zustand vanilla 风格，零依赖，纯 TS）。
 *
 * 模型：会话树对象身份稳定、原地修改；每次 mutate 后 version++ 并通知订阅者，
 * React 侧经 useSyncExternalStore 以 version 为快照触发重渲（见 use-thread-store.ts）。
 * 组件不允许直接改树，所有变更走这里的方法——这也是 demo 能通过
 * react-hooks/immutability 等规则的关键：mutation 全部收敛在非 React 代码里。
 */

import type { TextAnchor } from "../branching/text-anchor"
import type {
  ArtifactSeed,
  MarkdownGenerationProgress,
  Message,
  ThreadTreeState,
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

export function createThreadStore(seed: ThreadTreeState) {
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
    seed_: ArtifactSeed
  ): string => {
    const id = "a" + state.seq++
    state.artifacts[id] = { id, sourceThreadId, ...seed_ }
    state.artifactOrder.push(id)
    return id
  }

  /** 删除一条消息名下的全部 artifact，不发通知（retry 原子复位用）。 */
  const removeMessageArtifactsSilently = (message: Message): void => {
    if (!message.artifactIds?.length) return
    const removing = new Set(message.artifactIds)
    removing.forEach((id) => delete state.artifacts[id])
    state.artifactOrder = state.artifactOrder.filter((id) => !removing.has(id))
    message.artifactIds = undefined
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
        parentId: input.sourceThreadId,
        depth,
        title,
        anchorText: input.anchorText,
        forkFromMsgId: input.sourceMsgId,
        footnote: state.footnoteCounter,
        children: [],
        messages: [],
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
        role: "user",
        text,
        forks: [],
        ...(quote ? { quote } : {}),
      })
      touchSilently(threadId)
      notify()
      return id
    },

    /** 新建一条 pending 的空 assistant 消息（流式回复的占位），返回消息 id */
    beginAssistantMessage(threadId: string): string | null {
      const t = state.threads[threadId]
      if (!t) return null
      const id = "m" + state.seq++
      t.messages.push({
        id,
        role: "assistant",
        text: "",
        forks: [],
        status: "pending",
      })
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

    /** 流式结束：标记消息完成 */
    finishAssistantMessage(threadId: string, msgId: string): void {
      const t = state.threads[threadId]
      if (!t) return
      const msg = findMessageFromTail(t.messages, msgId)
      if (!msg) return
      msg.markdownGeneration = undefined
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
      msg.status = "error"
      msg.error = message
      notify()
    },

    /** 重试前重置消息：清空正文与错误，回到 pending，复用同一 msgId */
    resetAssistantMessage(threadId: string, msgId: string): void {
      const t = state.threads[threadId]
      if (!t) return
      const msg = findMessageFromTail(t.messages, msgId)
      if (!msg) return
      removeMessageArtifactsSilently(msg)
      msg.text = ""
      msg.status = "pending"
      msg.error = undefined
      msg.markdownGeneration = undefined
      notify()
    },

    /** 替换某会话的标题（异步分支标题 D7：首答完成后由模型生成语义标题）。
        原子更新 + notify，列头 / ⌘K / 画布 / 面包屑随 version 重渲同步；
        随整树防抖存盘自然持久化。空白或未变化时不通知。 */
    setThreadTitle(threadId: string, title: string): void {
      const t = state.threads[threadId]
      if (!t) return
      const v = title.trim()
      if (!v || t.title === v) return
      t.title = v
      notify()
    },

    /** 单独登记一个 artifact（fork 之外的入口，预留） */
    registerArtifact(sourceThreadId: string, seed_: ArtifactSeed): string {
      const id = registerSilently(sourceThreadId, seed_)
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
      const id = registerSilently(threadId, seed_)
      message.artifactIds = [...(message.artifactIds ?? []), id]
      message.markdownGeneration = undefined
      // 完整工具输入已经到达：即使尚无正文，也不再显示 pending 三点占位。
      if (message.status === "pending") message.status = "streaming"
      notify()
      return id
    },
  }
}
