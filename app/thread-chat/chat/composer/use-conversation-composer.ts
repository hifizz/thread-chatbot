"use client"

import { useRef, useState } from "react"
import type { LexicalEditor } from "lexical"
import { toast } from "sonner"
import { COMPOSER_MODEL_COPY } from "@/constants/composer-model"
import { forkFirstTurnContent, type MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import { composerDraftToMessageContent, messageContentToComposerDraft } from "@/lib/thread-chat/composer-draft-adapter"
import { appendComposerAttachments } from "@/lib/thread-chat/composer-attachments"
import { useArtifactResources, useComposerThread } from "./artifact-resources"
import { useComposerDraft } from "./composer-drafts"
import { $exportComposerDraft } from "./composer-codec"
import { useComposerAttachments } from "./use-composer-attachments"
import type { ConversationComposerProps } from "./conversation-composer-types"

/** 发送和模型切换的编排；展示组件只组合受控界面。 */
export function useConversationComposer({ threadId, isMain, busy, prefill, modelId, modelSelectorDisabled, onModelChange, onSend, onBeforeSend }: ConversationComposerProps) {
  const artifacts = useArtifactResources()
  const thread = useComposerThread(threadId)
  const editorRef = useRef<LexicalEditor | null>(null)
  const attachments = useComposerAttachments(threadId, modelId)
  const inFlight = useRef(false)
  const [pending, setPending] = useState<"send" | "model" | null>(null)
  const submitting = pending === "send"
  const changingModel = pending === "model"
  const changeModel = async (nextModelId: string) => {
    if (!onModelChange || !isMain || inFlight.current || busy || modelSelectorDisabled) return
    inFlight.current = true
    setPending("model")
    try { await onModelChange(nextModelId) }
    catch { toast.error(COMPOSER_MODEL_COPY.failed) }
    finally { inFlight.current = false; setPending(null) }
  }
  const { entry, update, clearSubmitted } = useComposerDraft(threadId, () => {
    if (prefill && thread?.forkMessageId && thread.forkAnchor && thread.anchorText) {
      return messageContentToComposerDraft(forkFirstTurnContent({ text: prefill, sourceMessageId: thread.forkMessageId, anchorText: thread.anchorText, anchor: thread.forkAnchor }))
    }
    return { parts: prefill ? [{ localId: crypto.randomUUID(), type: "text", text: prefill }] : [] }
  })
  const hasQuestion = entry.draft.parts.some((part) => part.type === "text" && part.text.trim())
  const attachmentsReady = attachments.items.every((item) => item.status === "ready")
  const submit = async () => {
    if (!onSend || busy || inFlight.current || !editorRef.current) return
    const snapshot = editorRef.current.getEditorState().read($exportComposerDraft)
    const submittedAttachments = attachments.current()
    let content: MessageContentInput
    try { content = composerDraftToMessageContent(appendComposerAttachments(snapshot, submittedAttachments)) }
    catch (error) { toast.error(error instanceof Error ? error.message : "请检查输入内容"); return }
    update(snapshot)
    inFlight.current = true
    setPending("send")
    try {
      onBeforeSend?.()
      await onSend(content)
      clearSubmitted(snapshot)
      attachments.clearSubmitted(submittedAttachments)
    } catch {
      // 发送命令负责展示错误；保留原草稿和引用以供重试。
    } finally { inFlight.current = false; setPending(null) }
  }
  return { artifacts, editorRef, attachments, submitting, changingModel, changeModel, entry, update, hasQuestion, attachmentsReady, submit }
}
