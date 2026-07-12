/**
 * core/types —— 会话树的领域类型（headless，纯 TS，不含任何 React / DOM 概念）。
 *
 * 命名约定：一次「会话」称为 Thread（原型时期叫 Branch），主线也是一个 Thread（id 固定 "main"）。
 * 整棵树 + Artifact 登记表构成 ThreadTreeState，由 core/store.ts 统一变更。
 */

import type { TextAnchor } from "../branching/text-anchor"

export type Role = "user" | "assistant"
export type ArtifactKind = "code" | "note"

export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  lang?: string
  content: string
  /** 产生该 artifact 的会话（main 或分支 id） */
  sourceThreadId: string
}

/** 尚未落库的 artifact 内容（种子），落库时由 store 补全 id / 来源会话 */
export type ArtifactSeed = Omit<Artifact, "id" | "sourceThreadId">

/** 挂在消息原文上的分支锚点：一段被划选的文字 + 对应脚注号 + 目标会话 */
export interface Fork {
  /** 被划选的文字（= anchor.quote.exact），标题 / system 提示仍用它 */
  text: string
  num: number
  threadId: string
  depth: number
  /**
   * 文本锚点（TextQuoteSelector + TextPositionSelector）：在渲染后的 Markdown DOM 上
   * 三层降级（position → exact → fuzzy）重新定位高亮，对 DOM 结构与文本漂移免疫。
   * 采集失败（选区无法描述）时可缺省，此时该 fork 不高亮，但分支本体 / 脚注列表不受影响。
   */
  anchor?: TextAnchor
}

/** 消息的流式生命周期状态；undefined 视为 "done"（历史消息 / 非流式消息） */
export type MessageStatus = "pending" | "streaming" | "done" | "error"

export interface Message {
  id: string
  role: Role
  text: string
  forks: Fork[]
  artifactIds?: string[]
  /** 流式状态：pending（已建消息未收到首个 delta）/ streaming / done / error */
  status?: MessageStatus
  /** status === "error" 时的错误文案 */
  error?: string
}

export interface Thread {
  id: string
  parentId: string | null
  depth: number
  title: string
  /** 开出本会话时被划选的原文（主线为 null） */
  anchorText: string | null
  /** 从父会话哪条消息分叉出来（决定「继承的上文」截断点） */
  forkFromMsgId: string | null
  footnote: number | null
  children: string[]
  messages: Message[]
  /** 单调递增的活跃计数，用于「列满时替换 / 折叠最久未使用列」 */
  lastActive: number
}

export interface ThreadTreeState {
  threads: Record<string, Thread>
  artifacts: Record<string, Artifact>
  artifactOrder: string[]
  /** 最近访问过的会话（不含主线，新→旧，⌘K 面板的 chips 用） */
  recents: string[]
  footnoteCounter: number
  seq: number
  tick: number
}
