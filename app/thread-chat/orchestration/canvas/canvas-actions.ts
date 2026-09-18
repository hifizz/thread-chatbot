"use client"

import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

import { createContext } from "react"
import type { ThreadTreeState } from "../../core/types"
import type { MessageActionViewState } from "../../chat/actions/message-action-types"
import type { ThreadMessageActionCommands } from "../../chat/actions/message-action-commands"

/** 壳层用 chat-controller 组装后注入画布的会话动作。 */
export interface CanvasChatActions extends ThreadMessageActionCommands {
  send: (threadId: string, content: MessageContentInput) => unknown | Promise<unknown>
  stop: (threadId: string) => void
  retry: (threadId: string, messageId: string) => void
  /** 只读快照：画布内 composer 渲染静态条，消息动作缺席 */
  readOnly?: boolean
}

/** 画布节点面板可用的完整组合能力。 */
export interface CanvasActions extends CanvasChatActions {
  focusThread: (threadId: string) => void
  openArtifact: (artifactId: string, anchor?: TextAnchor) => void
  getState: () => ThreadTreeState
  setThreadModel: (threadId: string, modelId: string) => void | Promise<unknown>
  messageActionState: MessageActionViewState
}

/** 由 ThreadCanvas 提供、穿过 React Flow 到自定义节点的动作上下文。 */
export const CanvasActionsContext = createContext<CanvasActions | null>(null)
