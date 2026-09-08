"use client"

import { useRef, useState } from "react"
import type { LexicalEditor } from "lexical"
import { MicIcon } from "lucide-react"
import { toast } from "sonner"
import { ARTIFACT_REFERENCE_COPY } from "@/constants/artifact-reference"
import { COMPOSER_ATTACHMENT_COPY } from "@/constants/attachment"
import { composerDraftToMessageContent, forkFirstTurnContent, messageContentToUiParts, messagePartsToComposerDraft, type MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import { Composer, ComposerActions, ComposerAttachButton, ComposerBar, ComposerSend, ComposerToolbar } from "@/components/assistant-ui/elements/composer"
import { ghostButton } from "@/components/assistant-ui/elements/surfaces"
import { OfficialComposerTheme } from "@/components/assistant-ui/official-composer-demo/theme"
import { MessageEditor } from "./message-editor"
import { useArtifactResources, useComposerThread } from "./artifact-resources"
import { useComposerDraft } from "./composer-drafts"
import { $exportComposerDraft } from "./composer-codec"
import styles from "./artifact-composer.module.css"
import { useComposerAttachments } from "./use-composer-attachments"
import { ComposerAttachmentTray } from "./composer-attachment-tray"
import { THREAD_COMPOSER_ACCEPT } from "./thread-attachment-model"
import { appendComposerAttachments } from "@/lib/thread-chat/composer-attachments"
import { COMPOSER_MODEL_COPY } from "@/constants/composer-model"
import { ComposerModelSelector } from "./composer-model-selector"
import { GenerationSettingsControls } from "./generation-settings-controls"

type ConversationComposerProps = {
  variant: "column" | "canvas"; threadId: string; isMain: boolean; busy: boolean; prefill?: string | null;
  modelId?: string; modelSelectorDisabled: boolean; modelSelectorDisabledReason?: "branch" | "busy";
  onModelChange?(modelId: string): void | Promise<unknown>; onSend?(content: MessageContentInput): unknown | Promise<unknown>;
  onStop?(): void; onBeforeSend?(): void
}

/** 官方外壳接入有序草稿与发送协议；其他业务入口分步接入。 */
export function ConversationComposer(props: ConversationComposerProps) {
  return <OfficialComposerTheme key={props.threadId} embedded><ArtifactComposer {...props} /></OfficialComposerTheme>
}

function ArtifactComposer({ threadId, busy, prefill, modelId, modelSelectorDisabled, modelSelectorDisabledReason, onModelChange, onSend, onStop, onBeforeSend }: ConversationComposerProps) {
  const artifacts = useArtifactResources()
  const thread = useComposerThread(threadId)
  const editorRef = useRef<LexicalEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachments = useComposerAttachments(threadId, modelId)
  const inFlight = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [changingModel, setChangingModel] = useState(false)
  const modelChangeInFlight = useRef(false)
  const changeModel = async (nextModelId: string) => {
    if (!onModelChange || modelChangeInFlight.current || inFlight.current || busy || modelSelectorDisabled) return
    modelChangeInFlight.current = true
    setChangingModel(true)
    try { await onModelChange(nextModelId) }
    catch { toast.error(COMPOSER_MODEL_COPY.failed) }
    finally { modelChangeInFlight.current = false; setChangingModel(false) }
  }
  const { entry, update, clearSubmitted } = useComposerDraft(threadId, () => {
    if (prefill && thread?.forkMessageId && thread.forkAnchor && thread.anchorText) {
      return messagePartsToComposerDraft(messageContentToUiParts(forkFirstTurnContent({ text: prefill, sourceMessageId: thread.forkMessageId, anchorText: thread.anchorText, anchor: thread.forkAnchor })))
    }
    return { parts: prefill ? [{ localId: crypto.randomUUID(), type: "text", text: prefill }] : [] }
  })
  const hasQuestion = entry.draft.parts.some((part) => part.type === "text" && part.text.trim())
  const attachmentsReady = attachments.items.every((item) => item.status === "ready")
  const submit = async () => {
    if (!onSend || busy || inFlight.current || modelChangeInFlight.current || !editorRef.current) return
    const snapshot = editorRef.current.getEditorState().read($exportComposerDraft)
    const submittedAttachments = attachments.current()
    let content: MessageContentInput
    try { content = composerDraftToMessageContent(appendComposerAttachments(snapshot, submittedAttachments)) }
    catch (error) { toast.error(error instanceof Error ? error.message : "请检查输入内容"); return }
    update(snapshot)
    inFlight.current = true
    setSubmitting(true)
    try {
      onBeforeSend?.()
      await onSend(content)
      clearSubmitted(snapshot)
      attachments.clearSubmitted(submittedAttachments)
    } catch {
      // 发送命令负责展示错误；保留原草稿和引用以供重试。
    } finally { inFlight.current = false; setSubmitting(false) }
  }
  return <Composer>
    <ComposerBar>
      <input ref={fileInputRef} type="file" className="hidden" aria-label={COMPOSER_ATTACHMENT_COPY.add} accept={THREAD_COMPOSER_ACCEPT} multiple disabled={submitting}
        onChange={(event) => { attachments.add(Array.from(event.target.files ?? [])); event.target.value = "" }} />
      <ComposerAttachmentTray items={attachments.items} disabled={submitting} onRemove={attachments.remove} onRetry={attachments.retry} />
      <MessageEditor className={styles.editor} draft={entry.draft} revision={entry.revision} artifacts={artifacts}
        onChange={update} onSubmit={() => void submit()} editorRef={editorRef}
        placeholder={ARTIFACT_REFERENCE_COPY.placeholder} disabled={submitting} />
      <ComposerToolbar className="flex-wrap gap-2">
        <ComposerActions className="min-w-0 flex-wrap">
          <ComposerAttachButton title={COMPOSER_ATTACHMENT_COPY.add} disabled={submitting} onClick={() => fileInputRef.current?.click()} />
          <ComposerModelSelector modelId={modelId} disabled={modelSelectorDisabled || busy || submitting || changingModel || !onModelChange}
            disabledReason={modelSelectorDisabledReason ?? (busy || submitting ? "busy" : undefined)} onValueChange={changeModel} />
          {modelId && <GenerationSettingsControls modelId={modelId} disabled={busy || submitting || changingModel} />}
        </ComposerActions>
        <ComposerActions className="ms-auto">
          <button type="button" aria-label="语音输入" title="语音输入稍后接入" disabled className={`${ghostButton} size-8 opacity-30`}><MicIcon className="size-4" /></button>
          <ComposerSend streaming={busy} idle={!hasQuestion} disabled={busy ? !onStop : submitting || changingModel || !hasQuestion || !attachmentsReady || !onSend}
            onClick={busy ? onStop : () => void submit()} />
        </ComposerActions>
      </ComposerToolbar>
    </ComposerBar>
  </Composer>
}
