"use client"

import { useRef, useState, type ClipboardEvent, type DragEvent } from "react"
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from "lexical"
import { toast } from "sonner"
import { PlusIcon, AtSign } from "lucide-react"
import { composerDraftToMessageContent, forkFirstTurnContent, messageContentToUiParts, messagePartsToComposerDraft, type MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import { IMAGE_MODEL_VALIDATION_MESSAGE, MESSAGE_ATTACHMENT_MAX_FILES } from "@/constants/attachment"
import { supportsModelImageInput } from "@/constants/model"
import { uploadAttachment, normalizeAttachmentFile, validateAttachmentFile } from "@/lib/attachments/upload"
import { preprocessImageAttachment } from "@/lib/attachments/image"
import { createPastedTextFile, shouldInlinePastedText, canAddThreadImages, THREAD_COMPOSER_ACCEPT, isThreadComposerFile } from "./thread-attachment-model"
import { GenerationSettingsControls } from "./generation-settings-controls"
import { ThreadModelSelector } from "./thread-model-selector"
import { MessageEditor } from "./message-editor"
import { $createComposerCapsuleNode } from "./composer-capsule-node"
import { $exportComposerDraft } from "./composer-codec"
import { useComposerDraft } from "./composer-drafts"
import { useArtifactResources, useComposerThread } from "./artifact-resources"

type ConversationComposerProps = {
  variant: "column" | "canvas"; threadId: string; isMain: boolean; busy: boolean; prefill?: string | null;
  modelId?: string; modelSelectorDisabled: boolean; modelSelectorDisabledReason?: "branch" | "busy";
  onModelChange?(modelId: string): void; onSend?(content: MessageContentInput): unknown | Promise<unknown>;
  onStop?(): void; onBeforeSend?(): void
}

export function ConversationComposer(props: ConversationComposerProps) {
  return <ThreadComposer key={props.threadId} {...props} />
}

function ThreadComposer(props: ConversationComposerProps) {
  const { threadId, variant, modelId, busy, onSend } = props
  const thread = useComposerThread(threadId)
  const artifacts = useArtifactResources()
  const editorRef = useRef<LexicalEditor | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const { entry, update, clearSubmitted, resolveUpload, failUpload } = useComposerDraft(threadId, () => {
    if (props.prefill && thread?.forkMessageId && thread.forkAnchor && thread.anchorText) {
      const content = forkFirstTurnContent({ text: props.prefill, sourceMessageId: thread.forkMessageId, anchorText: thread.anchorText, anchor: thread.forkAnchor })
      return messagePartsToComposerDraft(messageContentToUiParts(content))
    }
    return { parts: props.prefill ? [{ localId: crypto.randomUUID(), type: "text", text: props.prefill }] : [] }
  })
  const submit = async () => {
    if (!onSend || busy || submitting || !editorRef.current) return
    let snapshot: ThreadComposerDraft
    let content: MessageContentInput
    try {
      snapshot = editorRef.current.getEditorState().read($exportComposerDraft)
      content = composerDraftToMessageContent(snapshot)
      if (!supportsModelImageInput(modelId) && content.parts.some((part) => part.type === "file" && part.file.mediaType.startsWith("image/"))) throw new Error(IMAGE_MODEL_VALIDATION_MESSAGE)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "请检查输入内容")
      return
    }
    update(snapshot)
    setSubmitting(true)
    props.onBeforeSend?.()
    try {
      await onSend(content)
      clearSubmitted(snapshot)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败，草稿已保留")
    } finally { setSubmitting(false) }
  }
  const appendFiles = (files: Iterable<File>) => {
    const editor = editorRef.current
    if (!editor) return
    const reserved = editor.getEditorState().read($exportComposerDraft).parts.slice()
    for (const source of files) {
      const file = normalizeAttachmentFile(source)
      try {
        if (!isThreadComposerFile(file)) throw new Error("不支持的文件类型")
        validateAttachmentFile(file)
        if (reserved.filter((part) => part.type === "file" || part.type === "upload").length >= MESSAGE_ATTACHMENT_MAX_FILES) throw new Error(`附件不能超过 ${MESSAGE_ATTACHMENT_MAX_FILES} 个`)
        if (file.type.startsWith("image/")) {
          if (!supportsModelImageInput(modelId)) throw new Error(IMAGE_MODEL_VALIDATION_MESSAGE)
          if (!canAddThreadImages(reserved, 1)) throw new Error("图片数量超过单条消息上限")
        }
      } catch (error) { toast.error(error instanceof Error ? error.message : "附件校验失败"); continue }
      const localId = crypto.randomUUID()
      const part = { type: "upload" as const, localId, filename: file.name, mediaType: file.type }
      reserved.push(part)
      editorRef.current?.update(() => {
        $getRoot().selectEnd().insertNodes([$createComposerCapsuleNode(part, `上传中：${file.name}`)])
      })
      void preprocessImageAttachment(file)
        .then((ready) => uploadAttachment(ready))
        .then((result) => resolveUpload(localId, result.reference))
        .catch((error) => {
          const message = error instanceof Error ? error.message : "附件上传失败"
          failUpload(localId, message)
          toast.error(message)
        })
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); appendFiles(files); return }
    // Lexical 自己处理普通文字与应用内胶囊的公开剪贴板格式。
    const text = event.clipboardData.getData("text/plain")
    if (text && !event.clipboardData.types.includes("application/x-lexical-editor") && !shouldInlinePastedText(text)) {
      event.preventDefault(); appendFiles([createPastedTextFile(text)])
    }
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault(); appendFiles(event.dataTransfer.files)
  }
  const canvas = variant === "canvas"
  return <div className={canvas ? "cv-composer" : `composer ${props.isMain ? "" : "branch"}`}>
    <div className={canvas ? "cv-prompt-stack" : "lane"}>
      <div className="box" onPasteCapture={onPaste} onDrop={onDrop} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault() }}>
        <div className="prompt-stack">
          <MessageEditor key={threadId} draft={entry.draft} revision={entry.revision} artifacts={artifacts} editorRef={editorRef} onChange={update} onSubmit={() => void submit()} placeholder={canvas ? "在画布节点里继续对话" : "输入问题，@ 引用 Artifact"} />
          <div className="composer-tools">
            <input ref={fileInput} type="file" multiple className="sr-only" accept={THREAD_COMPOSER_ACCEPT} onChange={(event) => { appendFiles(event.target.files ?? []); event.target.value = "" }} />
            <button type="button" className="attach-btn" aria-label="添加附件" onClick={() => fileInput.current?.click()}><PlusIcon size={14} /></button>
            <button type="button" className="attach-btn" aria-label="引用 Artifact" onMouseDown={(event) => event.preventDefault()} onClick={() => {
              editorRef.current?.focus(() => editorRef.current?.update(() => {
                const selection = $getSelection()
                const range = $isRangeSelection(selection) ? selection : $getRoot().selectEnd()
                range.insertText(" @")
              }))
            }}><AtSign size={14} /></button>
            {modelId && <><ThreadModelSelector modelId={modelId} disabled={props.modelSelectorDisabled} compact={canvas} disabledReason={props.modelSelectorDisabledReason} onValueChange={(id) => props.onModelChange?.(id)} /><GenerationSettingsControls modelId={modelId} disabled={props.modelSelectorDisabled} /></>}
          </div>
        </div>
        {busy ? <button className="send stop" onClick={props.onStop}>停止</button> : <button className="send" disabled={submitting || entry.draft.parts.some((part) => part.type === "upload")} onClick={() => void submit()}>{submitting ? "发送中…" : "发送"}</button>}
      </div>
    </div>
  </div>
}
