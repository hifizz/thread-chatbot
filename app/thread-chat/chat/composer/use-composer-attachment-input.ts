"use client"

import { useRef, useState, type ClipboardEvent, type DragEvent } from "react"
import { LEXICAL_CLIPBOARD_MIME } from "@/constants/composer"
import { createPastedTextFile, shouldInlinePastedText } from "./thread-attachment-model"

/** 文件选择、粘贴和拖入共用上传队列；普通文字和引用交还给 Lexical。 */
export function useComposerAttachmentInput(add: (files: Iterable<File>) => void, disabled: boolean) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragActive, setDragActive] = useState(false)

  function onPasteCapture(event: ClipboardEvent<HTMLDivElement>) {
    const data = event.clipboardData
    const files = Array.from(data.files)
    if (!files.length && data.types.includes(LEXICAL_CLIPBOARD_MIME)) return
    const text = data.getData("text/plain")
    if (!files.length && shouldInlinePastedText(text)) return
    event.preventDefault()
    event.stopPropagation()
    if (!disabled) add(files.length ? files : [createPastedTextFile(text)])
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    dragDepth.current += 1
    if (!disabled) setDragActive(true)
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDragActive(false)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = disabled ? "none" : "copy"
  }

  function onDropCapture(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragActive(false)
    if (!disabled) add(Array.from(event.dataTransfer.files))
  }

  return {
    fileInputRef,
    openFilePicker: () => { if (!disabled) fileInputRef.current?.click() },
    inputProps: {
      disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!disabled) add(Array.from(event.target.files ?? []))
        event.target.value = ""
      },
    },
    surfaceProps: { dragActive: dragActive && !disabled, onPasteCapture, onDragEnter, onDragLeave, onDragOver, onDropCapture },
  }
}
