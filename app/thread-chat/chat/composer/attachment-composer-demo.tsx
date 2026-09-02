"use client"

import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useRef,
  useState,
} from "react"
import { FileIcon, PlusIcon, XIcon } from "lucide-react"

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
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
import { cn } from "@/lib/utils"

import {
  appendDemoAttachments,
  createDemoAttachments,
  createPastedTextAttachment,
  removeDemoAttachment,
  type AttachmentComposerDemoProps,
  type DemoAttachmentSource,
} from "./attachment-composer-demo-model"

function attachmentDescription(file: File, source: DemoAttachmentSource) {
  return `${file.type || "未知类型"} · ${source}`
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files")
}

export function AttachmentComposerDemo({
  attachments,
  onChange,
}: AttachmentComposerDemoProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [text, setText] = useState("")
  const [isDragging, setIsDragging] = useState(false)

  const emitChange = useCallback(
    (nextAttachments: typeof attachments) => onChange(nextAttachments),
    [onChange]
  )

  const appendFiles = useCallback(
    (files: Iterable<File>, source: DemoAttachmentSource) => {
      const added = createDemoAttachments(files, source)
      if (added.length === 0) return
      emitChange(appendDemoAttachments(attachments, added))
    },
    [attachments, emitChange]
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
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (pastedFiles.length > 0) {
      event.preventDefault()
      appendFiles(pastedFiles, "paste")
      return
    }

    const pastedText = event.clipboardData.getData("text/plain")
    const textAttachment = createPastedTextAttachment(pastedText)
    if (!textAttachment) return

    event.preventDefault()
    emitChange(appendDemoAttachments(attachments, [textAttachment]))
  }

  return (
    <div
      data-testid="attachment-composer-demo"
      className={cn(
        "w-full min-w-0 rounded-3xl border bg-card p-3 text-card-foreground shadow-sm transition-[border-color,box-shadow,background-color]",
        isDragging &&
          "border-primary bg-primary/5 ring-2 ring-primary/15 ring-offset-2 ring-offset-background"
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {attachments.length > 0 ? (
        <AttachmentGroup
          data-testid="attachment-tray"
          aria-label="已添加的附件"
          className="w-full max-w-full pb-2"
        >
          {attachments.map((attachment) => (
            <Attachment
              key={attachment.id}
              data-testid="attachment-item"
              className="w-60 max-w-[min(15rem,80vw)] flex-nowrap"
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
                  {attachmentDescription(attachment.file, attachment.source)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  type="button"
                  aria-label={`移除 ${attachment.file.name || "未命名附件"}`}
                  data-testid="remove-attachment"
                  onClick={(event) => {
                    event.stopPropagation()
                    emitChange(removeDemoAttachment(attachments, attachment.id))
                  }}
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      ) : null}

      <textarea
        data-testid="attachment-composer-textarea"
        aria-label="输入提示词"
        placeholder="输入提示词，或粘贴、拖入附件…"
        rows={3}
        value={text}
        className="max-h-56 min-h-24 w-full resize-y bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
        onChange={(event) => setText(event.currentTarget.value)}
      />

      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <input
          ref={inputRef}
          data-testid="attachment-file-input"
          className="sr-only"
          type="file"
          multiple
          tabIndex={-1}
          onChange={handleFileChange}
        />
        <TooltipIconButton
          type="button"
          aria-label="添加附件"
          tooltip="添加附件"
          className="size-8 rounded-full border bg-background"
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon />
        </TooltipIconButton>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {isDragging ? "释放以添加文件" : `${attachments.length} 个附件`}
        </span>
      </div>
    </div>
  )
}
