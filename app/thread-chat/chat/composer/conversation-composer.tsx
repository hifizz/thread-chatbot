"use client"

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react"
import { FileIcon, PlusIcon, XIcon } from "lucide-react"
import { ThreadModelSelector } from "./thread-model-selector"
import {
  composerMaxHeight,
  composerSubmission,
  shouldSubmitComposerKey,
} from "./conversation-composer-logic"
import {
  appendDemoAttachments,
  createDemoAttachments,
  removeDemoAttachment,
  type DemoAttachment,
  type DemoAttachmentSource,
} from "./attachment-composer-demo-model"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"

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

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files")
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [attachments, setAttachments] = useState<DemoAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const canvas = variant === "canvas"
  const maxHeight = composerMaxHeight(variant)

  const doSend = () => {
    const ta = taRef.current
    if (!ta || !onSend) return
    const text = composerSubmission(ta.value, busy)
    if (!text) return
    ta.value = ""
    ta.style.height = "auto"
    onBeforeSend?.()
    onSend(text)
    if (!canvas) setAttachments([])
    ta.focus(canvas ? { preventScroll: true } : undefined)
  }

  const appendFiles = useCallback(
    (files: Iterable<File>, source: DemoAttachmentSource) => {
      const added = createDemoAttachments(files, source)
      if (added.length === 0) return
      setAttachments((current) => appendDemoAttachments(current, added))
    },
    []
  )

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    appendFiles(event.currentTarget.files ?? [], "picker")
    event.currentTarget.value = ""
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (hasDraggedFiles(event)) event.dataTransfer.dropEffect = "copy"
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    appendFiles(event.dataTransfer.files, "drop")
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // 与 demo 不同：纯文本粘贴保持正常插入文字，只有文件/图片粘贴才进附件托盘。
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (pastedFiles.length === 0) return
    event.preventDefault()
    appendFiles(pastedFiles, "paste")
  }

  useEffect(() => {
    const ta = taRef.current
    if (!ta || !prefill || ta.value !== "") return
    ta.value = prefill
    autoGrow(ta, maxHeight)
    ta.focus(canvas ? { preventScroll: true } : undefined)
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [canvas, maxHeight, threadId, prefill])

  const handleBoxPointerDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // 点击 box 任意位置都把焦点交给 textarea（附件卡片的交互不吞掉这个行为之外的事）。
    if (event.target instanceof Element && event.target.closest("button, a")) {
      if (event.target.closest('[data-slot="attachment"]')) return
    }
    const ta = taRef.current
    if (!ta) return
    const isFocused = document.activeElement === ta
    const selection = window.getSelection()
    if (isFocused || !selection?.isCollapsed) return
    event.preventDefault()
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }

  const textarea = (
    <textarea
      ref={taRef}
      rows={1}
      style={
        { "--composer-max-height": `${maxHeight}px` } as React.CSSProperties
      }
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

  const attachmentTray =
    !canvas && attachments.length > 0 ? (
      <AttachmentGroup
        data-testid="composer-attachment-tray"
        aria-label="已添加的附件"
        className="composer-attachment-tray w-full max-w-full"
      >
        {attachments.map((attachment) => (
          <Attachment
            key={attachment.id}
            data-testid="composer-attachment-item"
            className="composer-attachment-item w-60 max-w-[min(15rem,80vw)] flex-nowrap"
            size="sm"
          >
            <AttachmentMedia aria-hidden="true">
              <FileIcon />
            </AttachmentMedia>
            <AttachmentContent className="overflow-hidden">
              <AttachmentTitle>
                {attachment.file.name || "未命名附件"}
              </AttachmentTitle>
              <AttachmentDescription>
                {attachment.file.type || "未知类型"}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                type="button"
                aria-label={`移除 ${attachment.file.name || "未命名附件"}`}
                data-testid="composer-remove-attachment"
                onClick={(event) => {
                  event.stopPropagation()
                  setAttachments((current) =>
                    removeDemoAttachment(current, attachment.id)
                  )
                }}
              >
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
    ) : null

  const promptStack = canvas ? (
    <div className="cv-prompt-stack">
      {selector}
      {textarea}
    </div>
  ) : (
    <div className="prompt-stack">
      {attachmentTray}
      {textarea}
      <div className="composer-tools">
        <input
          ref={fileInputRef}
          data-testid="composer-file-input"
          className="sr-only"
          type="file"
          multiple
          tabIndex={-1}
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="attach-btn"
          aria-label="添加附件"
          title="添加附件"
          data-testid="composer-attach-button"
          onClick={() => fileInputRef.current?.click()}
        >
          <PlusIcon size={14} aria-hidden="true" />
        </button>
        {selector}
      </div>
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
        <div
          className={`box${isDragging ? " attach-dragging" : ""}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onPaste={handlePaste}
          onMouseDown={handleBoxPointerDown}
        >
          {promptStack}
          {button}
        </div>
      </div>
    </div>
  )
}
