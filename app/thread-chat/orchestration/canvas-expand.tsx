"use client"

import React, { useContext, useEffect, useRef } from "react"
import { AnchoredAssistantBody } from "../branching/anchored-assistant-body"
import { ConversationComposer } from "../chat/conversation-composer"
import { ConversationMessage } from "../chat/conversation-message"
import { MessageArtifacts } from "./message-artifacts"
import { CanvasActionsContext } from "./canvas-actions"
import { CANVAS_EXPAND_WIDTH } from "./canvas-dimensions"
import type { CanvasCardData } from "./canvas-node"

/** 距底小于该值时，流式增长继续自动跟底。 */
const STICK_THRESHOLD = 40

/** 选中 Canvas 卡片下方的完整消息列表 + composer 外挂面板。 */
export function CanvasExpand({
  threadId,
  data,
}: {
  threadId: string
  data: CanvasCardData
}) {
  const actions = useContext(CanvasActionsContext)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const last = data.messages[data.messages.length - 1]
  const busy =
    last?.role === "assistant" &&
    (last.status === "pending" || last.status === "streaming")

  // SmoothText 逐帧长高 / 消息增删 / 刚展开都跟底；用户上滑后由 onScroll 释放。
  useEffect(() => {
    const element = listRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  })

  const state = actions?.getState()
  const presentation =
    actions?.messageActionState.presentationByThreadId.get(threadId)

  return (
    <div
      className="canvas-expand nodrag nowheel"
      style={
        {
          "--canvas-expand-width": `${CANVAS_EXPAND_WIDTH}px`,
        } as React.CSSProperties
      }
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div
        className="msg-list mini"
        data-list={threadId}
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            STICK_THRESHOLD
        }}
      >
        {data.messages.map((message) => (
          <ConversationMessage
            key={message.id}
            threadId={threadId}
            message={message}
            renderUserFallback={() => null}
            renderAssistantBody={(assistantMessage) =>
              state && actions ? (
                <AnchoredAssistantBody
                  state={state}
                  message={assistantMessage}
                  onOpenThread={(id) => actions.focusThread(id)}
                />
              ) : null
            }
            renderAfterMessage={(sourceMessage) => (
              <MessageArtifacts
                state={state}
                message={sourceMessage}
                sourceDepth={data.depth}
                compact
                onOpen={actions?.openArtifact}
              />
            )}
            onRetry={(failedMessage) =>
              actions?.retry(threadId, failedMessage.id)
            }
            messageActionState={actions?.messageActionState}
            messageCommands={actions ?? undefined}
            editableUserMessageId={presentation?.latestUserMessageId}
            regeneratableAssistantMessageId={
              presentation?.latestAssistantMessageId
            }
            turnAlternatives={presentation?.alternatives ?? []}
          />
        ))}
      </div>
      <ConversationComposer
        variant="canvas"
        threadId={threadId}
        isMain={data.isMain}
        busy={busy}
        prefill={data.prefill}
        modelId={state?.threads[threadId]?.modelId}
        modelSelectorDisabled={!data.isMain || busy}
        modelSelectorDisabledReason={
          !data.isMain ? "branch" : busy ? "busy" : undefined
        }
        onModelChange={
          actions
            ? (modelId) => actions.setThreadModel(threadId, modelId)
            : undefined
        }
        onBeforeSend={() => {
          stickRef.current = true
        }}
        onSend={actions ? (text) => actions.send(threadId, text) : undefined}
        onStop={() => actions?.stop(threadId)}
      />
    </div>
  )
}
