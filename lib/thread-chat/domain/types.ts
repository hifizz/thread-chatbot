/**
 * Thread Chat 会话树领域类型（headless，纯 TS，不含任何 React / DOM 概念）。
 *
 * 命名约定：一次「会话」称为 Thread（原型时期叫 Branch），主线也是一个 Thread（id 固定 "main"）。
 * 整棵树 + Artifact 登记表构成 ThreadTreeState，由应用层 store 统一变更。
 */

import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import type { MessageFeedback } from "@/lib/thread-chat/contracts/message-feedback"

export type { MessageFeedback } from "@/lib/thread-chat/contracts/message-feedback"

export type Role = "user" | "assistant"
export type ArtifactKind = "code" | "note" | "markdown"

export interface MessageFeedbackSummary {
  treeId: string
  threadId: string
  messageId: string
  feedback: MessageFeedback
  updatedAt: string
}

export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  lang?: string
  content: string
  /** 产生该 artifact 的会话（main 或分支 id） */
  sourceThreadId: string
  /** 产生该 artifact 的不可变 assistant 消息节点。 */
  sourceMessageId: string
}

/** 尚未落库的 artifact 内容（种子），落库时由 store 补全 id / 来源会话 */
export type ArtifactSeed = Omit<
  Artifact,
  "id" | "sourceThreadId" | "sourceMessageId"
>

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

/**
 * Markdown 工具输入的临时生成态。它只服务当前页面的进度反馈，不能持久化；
 * 完整 input 到达后由正式 Artifact 原子替换。
 */
export interface MarkdownGenerationProgress {
  toolCallId: string
  phase: "starting" | "streaming"
  partialTitle?: string
  characterCount: number
  lineCount: number
  /** 最近解析到的 Markdown ATX 标题，最多保留三项。 */
  headings: string[]
}

export interface Message {
  id: string
  /** 同一 Thread 内的父消息；终态节点创建后不得改写。 */
  parentMessageId: string | null
  role: Role
  text: string
  forks: Fork[]
  /** 当前 assistant attempt 的应用 generation id；user 消息不设置。 */
  generationId?: string
  /** 本页是通过刷新恢复到该活跃 generation；只用于向用户解释后台仍在继续。 */
  backgroundGeneration?: boolean
  artifactIds?: string[]
  /** 流式状态：pending（已建消息未收到首个 delta）/ streaming / done / error */
  /** 划选引用（方向 C，用户定稿）：带问开分支时，首条 user 消息结构化携带
      「我在问哪段话」——消息记录自足（导出/搜索/其他消费者拿到即用），UI 渲染
      引用条，发送线据此拼 grounding。可选；无该字段 = 普通消息。 */
  quote?: { text: string }
  status?: MessageStatus
  /** status === "error" 时的错误文案 */
  error?: string
  /** 当前页临时态；存盘前必须剥离，加载时也会防御性清理。 */
  markdownGeneration?: MarkdownGenerationProgress
  /** 联网搜索/深读活动；完成结果随消息持久化，刷新后仍可核验来源。 */
  webResearch?: WebResearchActivity[]
  /** 第一次联网工具事件到达时，已接收正文的 UTF-16 字符偏移；用于原位插入聚合面板。 */
  webResearchTextOffset?: number
  /** 本轮联网路由决策；不含原始 CoT。 */
  researchRoute?: ResearchRoute
  /** 复杂研究的结构化计划；随消息持久化，供 UI 和调试核验。 */
  researchPlan?: ResearchPlan
}

export interface Thread {
  id: string
  /** 下一次请求使用的统一模型注册表 id。 */
  modelId: string
  parentId: string | null
  depth: number
  title: string
  /** 开出本会话时被划选的原文（主线为 null） */
  anchorText: string | null
  /** 从父会话哪条消息分叉出来（决定「继承的上文」截断点） */
  forkFromMsgId: string | null
  footnote: number | null
  children: string[]
  /** 保存该 Thread 的全部消息节点，顺序为创建顺序。 */
  messages: Message[]
  /** 当前可见消息路径的末端节点。 */
  activeLeafMessageId: string | null
  /** 单调递增的活跃计数，用于「列满时替换 / 折叠最久未使用列」 */
  lastActive: number
}

export interface ThreadTreeState {
  schemaVersion: 2
  threads: Record<string, Thread>
  artifacts: Record<string, Artifact>
  artifactOrder: string[]
  /** 最近访问过的会话（不含主线，新→旧，⌘K 面板的 chips 用） */
  recents: string[]
  footnoteCounter: number
  seq: number
  tick: number
}
