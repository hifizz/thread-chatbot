"use client"

import React, { useEffect, useRef } from "react"
import { ThreadModelSelector } from "./thread-model-selector"
import {
  composerSubmission,
  shouldSubmitComposerKey,
} from "./conversation-composer-logic"

type ConversationComposerProps = {
  variant: "column" | "canvas"
  threadId: string
  isMain: boolean
  busy: boolean
  prefill?: string | null
  modelId?: string
  modelSelectorDisabled: boolean
  modelSelectorDisabledReason?: "branch" | "busy"
  onModelChange?(modelId: string): void
  onSend?(text: string): void
  onStop?(): void
  onBeforeSend?(): void
}

function autoGrow(ta: HTMLTextAreaElement, maxHeight: number) {
  ta.style.height = "auto"
  ta.style.height = Math.min(ta.scrollHeight, maxHeight) + "px"
}

export function ConversationComposer({
  variant,
  threadId,
  isMain,
  busy,
  prefill,
  modelId,
  modelSelectorDisabled,
  modelSelectorDisabledReason,
  onModelChange,
  onSend,
  onStop,
  onBeforeSend,
}: ConversationComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const canvas = variant === "canvas"
  const maxHeight = canvas ? 68 : 120

  const doSend = () => {
    const ta = taRef.current
    if (!ta || !onSend) return
    const text = composerSubmission(ta.value, busy)
    if (!text) return
    ta.value = ""
    ta.style.height = "auto"
    onBeforeSend?.()
    onSend(text)
    ta.focus(canvas ? { preventScroll: true } : undefined)
  }

  useEffect(() => {
    const ta = taRef.current
    if (!ta || !prefill || ta.value !== "") return
    ta.value = prefill
    autoGrow(ta, maxHeight)
    ta.focus(canvas ? { preventScroll: true } : undefined)
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [canvas, maxHeight, threadId, prefill])

  const textarea = (
    <textarea
      ref={taRef}
      rows={1}
      placeholder={
        canvas
          ? "就地继续这段会话…"
          : isMain
            ? "继续在主线提问…"
            : "在这个分支里追问…"
      }
      aria-label={canvas ? "在画布节点里继续对话" : undefined}
      onInput={(event) => autoGrow(event.currentTarget, maxHeight)}
      onKeyDown={(event) => {
        const nativeEvent = event.nativeEvent
        if (
          !shouldSubmitComposerKey({
            key: event.key,
            shiftKey: event.shiftKey,
            isComposing: nativeEvent.isComposing,
            keyCode: nativeEvent.keyCode,
          })
        )
          return
        event.preventDefault()
        doSend()
      }}
    />
  )

  const selector = modelId ? (
    <ThreadModelSelector
      modelId={modelId}
      disabled={modelSelectorDisabled}
      compact={canvas}
      disabledReason={modelSelectorDisabledReason}
      onValueChange={(nextModelId) => onModelChange?.(nextModelId)}
    />
  ) : null

  const promptStack = (
    <div className={canvas ? "cv-prompt-stack" : "prompt-stack"}>
      {canvas ? selector : textarea}
      {canvas ? textarea : selector}
    </div>
  )
  const button = busy ? (
    <button
      className={canvas ? "cv-send stop" : "send stop"}
      title="停止生成（已收到的内容会保留）"
      onClick={onStop}
    >
      停止
    </button>
  ) : (
    <button className={canvas ? "cv-send" : "send"} onClick={doSend}>
      发送
    </button>
  )

  if (canvas) {
    return (
      <div className="cv-composer">
        {promptStack}
        {button}
      </div>
    )
  }
  return (
    <div className={`composer ${isMain ? "" : "branch"}`}>
      <div className="lane">
        <div className="box">
          {promptStack}
          {button}
        </div>
      </div>
    </div>
  )
}
