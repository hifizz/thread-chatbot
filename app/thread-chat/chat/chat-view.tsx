"use client"
/**
 * chat/chat-view —— 单会话视图：消息列表 + composer + who 标签。
 *
 * 这一层不知道「树 / 列 / 分支」的存在：锚点高亮、脚注、artifact 卡片等
 * 分支能力全部通过 assistant 正文 / 后置区两个渲染插槽注入，
 * 列头 / focus banner / 继承上文则作为 header / banner ReactNode 传入。
 *
 * .lane 是纯展示的阅读通道包装（max --lane-max、列内居中）：消息流与 composer
 * 的内容收敛在通道里，纸面 / padding / 边框仍随列通栏；本层不感知列宽。
 */

import React from "react"
import { MessageScroller } from "@shadcn/react/message-scroller"
import type { Message } from "../core/types"
import { ConversationComposer } from "./composer/conversation-composer"
import { ConversationMessage } from "./message/conversation-message"
import type { MessageActionViewState } from "./actions/message-action-types"
import type { ThreadMessageActionCommands } from "./actions/message-action-commands"

export interface ChatViewProps {
  /** 会话 id：写到 .msg-list 的 data-list 上（划选气泡靠它反查消息） */
  threadId: string
  messages: Message[]
  isMain?: boolean
  /** 列头区（面包屑 / 标题行），由上层（branching）组装 */
  header?: React.ReactNode
  /** 列头之下、消息列表之上的横幅区（focus banner / 继承的上文） */
  banner?: React.ReactNode
  /** 消息列表顶部的插卡（主线的 hint 提示） */
  intro?: React.ReactNode
  /** 注入 assistant 正文渲染（锚点高亮 + 脚注上标） */
  renderAssistantBody?: (msg: Message) => React.ReactNode
  /** 注入 assistant 消息气泡之后的附加内容（artifact 卡片） */
  renderAfterMessage?: (msg: Message) => React.ReactNode
  /** 流式生成中：发送键变「停止」（textarea 仍可输入，Enter 提交被拦） */
  busy?: boolean
  /** 错误消息下的「重试」按钮回调 */
  onRetry?: (msg: Message) => void
  /** busy 时点「停止」的回调（中止本会话在飞的流式请求） */
  onStop?: () => void
  /** composer 预填文案（新开分支的代拟首问）：仅在输入框为空时写入，待用户改写或回车确认 */
  composerPrefill?: string
  /** 当前 Thread 的模型注册表 id。 */
  modelId: string
  /** 外部模型策略控制：生成期间或分支 Thread 为 true。 */
  modelSelectorDisabled: boolean
  /** 分支锁定时显示模型切换限制说明；生成期间仅禁用。 */
  modelSelectorDisabledReason?: "branch" | "busy"
  onModelChange: (modelId: string) => void
  onSend: (text: string) => void
  messageActionState?: MessageActionViewState
  messageCommands?: ThreadMessageActionCommands
  editableUserMessageId?: string
  regeneratableAssistantMessageId?: string
  turnAlternatives?: readonly {
    assistantMessageId: string
    derivedThreadCount: number
  }[]
}

export function ChatView({
  threadId,
  messages,
  isMain = false,
  header,
  banner,
  intro,
  renderAssistantBody,
  renderAfterMessage,
  busy = false,
  onRetry,
  onStop,
  composerPrefill,
  modelId,
  modelSelectorDisabled,
  modelSelectorDisabledReason,
  onModelChange,
  onSend,
  messageActionState,
  messageCommands,
  editableUserMessageId,
  regeneratableAssistantMessageId,
  turnAlternatives = [],
}: ChatViewProps) {
  return (
    <>
      {header}
      {banner}
      {/* 滚动：交给 headless MessageScroller 接管「流式贴底 / 上滑释放 / 滚到底按钮」，
          见 §5 注释（下方 Provider）。.msg-list + data-list 必须保留——划选气泡靠
          .closest(".msg-list") + data-list 反查会话。 */}
      <MessageScroller.Provider autoScroll defaultScrollPosition="end">
        <MessageScroller.Root className="msg-scroll-root">
          <MessageScroller.Viewport className="msg-list" data-list={threadId}>
            <MessageScroller.Content>
              <div className="lane">
                {intro}
                {messages.map((msg) => (
                  <MessageScroller.Item key={msg.id} messageId={msg.id}>
                    <ConversationMessage
                      threadId={threadId}
                      message={msg}
                      showRoleLabel
                      assistantBubbleClassName="bubble mt-3 mb-1"
                      renderAssistantBody={renderAssistantBody}
                      renderAfterMessage={renderAfterMessage}
                      onRetry={onRetry}
                      messageActionState={messageActionState}
                      messageCommands={messageCommands}
                      editableUserMessageId={editableUserMessageId}
                      regeneratableAssistantMessageId={
                        regeneratableAssistantMessageId
                      }
                      turnAlternatives={turnAlternatives}
                    />
                  </MessageScroller.Item>
                ))}
              </div>
            </MessageScroller.Content>
          </MessageScroller.Viewport>
          <MessageScroller.Button direction="end" className="scroll-end-btn">
            <span className="scroll-end-icon">↓</span>
          </MessageScroller.Button>
        </MessageScroller.Root>
      </MessageScroller.Provider>
      <ConversationComposer
        variant="column"
        threadId={threadId}
        isMain={isMain}
        busy={busy}
        prefill={composerPrefill}
        modelId={modelId}
        modelSelectorDisabled={modelSelectorDisabled}
        modelSelectorDisabledReason={modelSelectorDisabledReason}
        onModelChange={onModelChange}
        onSend={onSend}
        onStop={onStop}
      />
    </>
  )
}
