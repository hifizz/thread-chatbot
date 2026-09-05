"use client"

import React from "react"
import {
  GENERATION_BACKGROUND_LABEL,
  GENERATION_STOPPED_LABEL,
} from "@/constants/generation"
import type { ConversationViewMessage } from "../../core/types"
import type { ThreadMessageActionCommands } from "../actions/message-action-commands"
import { AssistantMessageToolbar } from "../actions/assistant-message-toolbar"
import { assistantMessagePresentation } from "./conversation-message-logic"
import { EditableUserMessage } from "./editable-user-message"
import { UserMessageContent } from "./user-message-content"
import {
  hasCompletedAssistantActions,
  type MessageActionViewState,
} from "../actions/message-action-types"

/** 把换行转成 br；默认 assistant 正文用它保留段内换行。 */
function withBreaks(text: string, keyBase: string): React.ReactNode[] {
  const lines = text.split("\n")
  const output: React.ReactNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) output.push(<br key={`${keyBase}-br${index}`} />)
    if (line) output.push(line)
  })
  return output
}

function defaultAssistantBody(message: ConversationViewMessage): React.ReactNode {
  return message.text
    .split("\n\n")
    .map((paragraph, index) => (
      <p key={index}>{withBreaks(paragraph, `p${index}`)}</p>
    ))
}

function defaultUserFallback(message: ConversationViewMessage): React.ReactNode {
  return (
    <div className="bubble" data-role="user">
      <UserMessageContent key={message.id} message={message} />
    </div>
  )
}

export interface ConversationMessageProps {
  threadId: string
  message: ConversationViewMessage
  showRoleLabel?: boolean
  userRoleLabel?: string
  hasSupplementalContent?: boolean
  assistantBubbleClassName?: string
  renderAssistantBody?: (message: ConversationViewMessage) => React.ReactNode
  renderAfterMessage?: (message: ConversationViewMessage) => React.ReactNode
  renderUserFallback?: (message: ConversationViewMessage) => React.ReactNode
  onRetry?: (message: ConversationViewMessage) => void
  messageActionState?: MessageActionViewState
  messageCommands?: ThreadMessageActionCommands
  editableUserMessageId?: string
  regeneratableAssistantMessageId?: string
}

export function ConversationMessage({
  threadId,
  message,
  showRoleLabel = false,
  userRoleLabel = "你",
  hasSupplementalContent = false,
  assistantBubbleClassName = "bubble",
  renderAssistantBody = defaultAssistantBody,
  renderAfterMessage,
  renderUserFallback = defaultUserFallback,
  onRetry,
  messageActionState,
  messageCommands,
  editableUserMessageId,
  regeneratableAssistantMessageId,
}: ConversationMessageProps) {
  const presentation = assistantMessagePresentation(message)

  return (
    <div className={`message ${message.role}`} data-msg-id={message.id}>
      {showRoleLabel && (
        <div className="who">{message.role === "user" ? userRoleLabel : "AI"}</div>
      )}
      {message.role === "user" ? (
        messageCommands ? (
          <EditableUserMessage
            threadId={threadId}
            message={message}
            editable={message.id === editableUserMessageId}
            recovery={messageActionState?.recoverableByUserMessageId.get(
              message.id
            )}
            commands={messageCommands}
          />
        ) : (
          renderUserFallback(message)
        )
      ) : (
        <>
          {(presentation.showBubble || hasSupplementalContent) && (
            <div className={assistantBubbleClassName} data-role="assistant">
              {message.backgroundGeneration && (
                <span className="generation-background" role="status">
                  {GENERATION_BACKGROUND_LABEL}
                </span>
              )}
              {presentation.isWaitingForVisibleOutput ? (
                <span
                  className="typing"
                  role="status"
                  aria-label={
                    message.backgroundGeneration
                      ? GENERATION_BACKGROUND_LABEL
                      : "正在生成回复"
                  }
                >
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <>
                  {renderAssistantBody(message)}
                  {presentation.showCaret && <span className="caret" />}
                </>
              )}
            </div>
          )}
          {message.status === "error" && (
            <div className="msg-error">
              {message.error ?? "生成失败"}
              {onRetry && <button className="retry" onClick={() => onRetry(message)}>
                重试
              </button>}
            </div>
          )}
          {message.status === "stopped" && (
            <div className="msg-stopped" role="status">
              <span>{GENERATION_STOPPED_LABEL}</span>
              {onRetry && <button className="retry" onClick={() => onRetry(message)}>
                重试
              </button>}
            </div>
          )}
          {messageCommands && hasCompletedAssistantActions(message) && (
            <div className="assistant-actions-row">
              <AssistantMessageToolbar
                threadId={threadId}
                message={message}
                regeneratable={message.id === regeneratableAssistantMessageId}
                feedback={messageActionState?.feedbackByMessageId.get(
                  message.id
                )}
                commands={messageCommands}
              />
            </div>
          )}
          {renderAfterMessage?.(message)}
        </>
      )}
    </div>
  )
}
