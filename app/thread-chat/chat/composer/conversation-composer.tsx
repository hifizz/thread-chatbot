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
import { toast } from "sonner"
import {
  IMAGE_ATTACHMENT_LIMITS,
  IMAGE_MODEL_VALIDATION_MESSAGE,
} from "@/constants/attachment"
import { ThreadModelSelector } from "./thread-model-selector"
import {
  composerMaxHeight,
  composerSubmission,
  shouldSubmitComposerKey,
} from "./conversation-composer-logic"
import {
  canAddThreadImages,
  canSendThreadAttachments,
  createPastedTextFile,
  hasUnsupportedReadyImages,
  isThreadComposerFile,
  isThreadComposerImageFile,
  readyThreadAttachmentReferences,
  shouldInlinePastedText,
  THREAD_COMPOSER_ACCEPT,
  type ThreadComposerAttachment,
} from "./thread-attachment-model"
import {
  deleteUploadedAttachment,
  normalizeAttachmentFile,
  uploadAttachment,
  validateAttachmentFile,
  type UploadedAttachmentReference,
} from "@/lib/attachments/upload"
import { preprocessImageAttachment } from "@/lib/attachments/image"
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
  onSend?(text: string, files: UploadedAttachmentReference[]): void
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
  const [attachments, setAttachments] = useState<ThreadComposerAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const canvas = variant === "canvas"
  const maxHeight = composerMaxHeight(variant)

  const doSend = () => {
    const ta = taRef.current
    if (!ta || !onSend) return
    const text = composerSubmission(ta.value, busy)
    if (!text || !canSendThreadAttachments(attachments)) return
    if (hasUnsupportedReadyImages(modelId, attachments)) {
      toast.error(IMAGE_MODEL_VALIDATION_MESSAGE)
      return
    }
    ta.value = ""
    ta.style.height = "auto"
    onBeforeSend?.()
    onSend(text, readyThreadAttachmentReferences(attachments))
    if (!canvas) setAttachments([])
    ta.focus(canvas ? { preventScroll: true } : undefined)
  }

  const appendFiles = useCallback(
    (files: Iterable<File>) => {
      const updateAttachment = (
        id: string,
        patch: Partial<Omit<ThreadComposerAttachment, "id">>
      ) =>
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === id ? { ...attachment, ...patch } : attachment
          )
        )

      const incoming = Array.from(files)
      const incomingImageCount = incoming.filter(
        isThreadComposerImageFile
      ).length
      if (!canAddThreadImages(attachments, incomingImageCount)) {
        toast.error(
          `单次最多添加 ${IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage} 张图片`
        )
        return
      }

      for (const sourceFile of incoming) {
        const id = crypto.randomUUID()
        const file = normalizeAttachmentFile(sourceFile)
        try {
          if (!isThreadComposerFile(file)) {
            throw new Error(`不支持的文件类型：${file.type || "未知"}`)
          }
          validateAttachmentFile(file)
        } catch (error) {
          setAttachments((current) => [
            ...current,
            {
              id,
              file,
              status: "error",
              progress: 0,
              error: error instanceof Error ? error.message : "附件校验失败",
            },
          ])
          continue
        }
        setAttachments((current) => [
          ...current,
          { id, file, status: "uploading", progress: 0 },
        ])
        void preprocessImageAttachment(file)
          .then((file) => {
            validateAttachmentFile(file)
            updateAttachment(id, { file })
            return uploadAttachment(file, {
              onProgress(progress) {
                updateAttachment(id, { progress })
              },
            }).then((result) => ({ file, result }))
          })
          .then(({ file, result }) =>
            updateAttachment(id, {
              file,
              status: "ready",
              progress: 1,
              serverId: result.serverId,
              reference: result.reference,
            })
          )
          .catch((error) =>
            updateAttachment(id, {
              status: "error",
              error:
                error instanceof Error ? error.message : "附件上传失败",
            })
          )
      }
    },
    [attachments]
  )

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    appendFiles(event.currentTarget.files ?? [])
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
    appendFiles(event.dataTransfer.files)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (pastedFiles.length > 0) {
      event.preventDefault()
      appendFiles(pastedFiles)
      return
    }
    const text = event.clipboardData.getData("text/plain")
    if (!text) return
    if (shouldInlinePastedText(text)) {
      const ta = taRef.current
      if (!ta) return
      event.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      ta.setRangeText(text, start, end, "end")
      autoGrow(ta, maxHeight)
      return
    }
    event.preventDefault()
    appendFiles([createPastedTextFile(text)])
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
                {attachment.status === "uploading"
                  ? `上传中 ${Math.round(attachment.progress * 100)}%`
                  : attachment.status === "ready"
                    ? "已就绪"
                    : attachment.error ?? "上传失败"}
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
                    current.filter((item) => item.id !== attachment.id)
                  )
                  if (attachment.serverId) {
                    void deleteUploadedAttachment(attachment.serverId)
                  }
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
          accept={THREAD_COMPOSER_ACCEPT}
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
    <button
      className={canvas ? "cv-send" : "send"}
      onClick={doSend}
      disabled={!canvas && !canSendThreadAttachments(attachments)}
    >
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
