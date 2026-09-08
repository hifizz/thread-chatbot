"use client"

import { ARTIFACT_REFERENCE_COPY } from "@/constants/artifact-reference"
import { COMPOSER_ATTACHMENT_COPY } from "@/constants/attachment"
import { COMPOSER_MODEL_COPY } from "@/constants/composer-model"
import { Composer, ComposerActions, ComposerAttachButton, ComposerBar, ComposerSend, ComposerToolbar } from "@/components/assistant-ui/elements/composer/layout"
import { ComposerVoiceButton } from "@/components/assistant-ui/elements/composer/voice"
import { ComposerTheme } from "@/components/assistant-ui/elements/composer/theme"
import { MessageEditor } from "./message-editor"
import { ComposerAttachmentTray } from "./composer-attachment-tray"
import { THREAD_COMPOSER_ACCEPT } from "./thread-attachment-model"
import { ComposerModelSelector } from "./composer-model-selector"
import { GenerationSettingsControls } from "./generation-settings-controls"
import { useComposerAttachmentInput } from "./use-composer-attachment-input"
import { useConversationComposer } from "./use-conversation-composer"
import type { ConversationComposerProps } from "./conversation-composer-types"
import styles from "./artifact-composer.module.css"

export function ConversationComposer(props: ConversationComposerProps) {
  return <ComposerTheme key={props.threadId} className={props.variant === "canvas" ? `${styles.frame} ${styles.canvasFrame}` : styles.frame}>
    <ComposerContent {...props} />
  </ComposerTheme>
}

function ComposerContent(props: ConversationComposerProps) {
  const { isMain, busy, modelId, modelSelectorDisabled, modelSelectorDisabledReason, onModelChange, onSend, onStop } = props
  const { artifacts, editorRef, attachments, submitting, changingModel, changeModel, entry, update, hasQuestion, attachmentsReady, submit } = useConversationComposer(props)
  const { fileInputRef, inputProps, surfaceProps, openFilePicker } = useComposerAttachmentInput(attachments.add, submitting)
  return <Composer className="max-w-(--lane-max)">
    <ComposerBar className={styles.bar} {...surfaceProps}>
      <input ref={fileInputRef} type="file" className="hidden" aria-label={COMPOSER_ATTACHMENT_COPY.add} accept={THREAD_COMPOSER_ACCEPT} multiple {...inputProps} />
      <ComposerAttachmentTray items={attachments.items} disabled={submitting} onRemove={attachments.remove} onRetry={attachments.retry} />
      <MessageEditor className={styles.editor} draft={entry.draft} revision={entry.revision} artifacts={artifacts}
        onChange={update} onSubmit={() => void submit()} editorRef={editorRef}
        placeholder={ARTIFACT_REFERENCE_COPY.placeholder} disabled={submitting} />
      <ComposerToolbar className={`${styles.toolbar} min-w-0 flex-nowrap gap-1`}>
        <ComposerActions className="min-w-0 flex-1 flex-nowrap overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
          <ComposerAttachButton title={COMPOSER_ATTACHMENT_COPY.add} disabled={submitting} onClick={openFilePicker} />
          <ComposerModelSelector modelId={modelId} disabled={!isMain || modelSelectorDisabled || busy || submitting || changingModel || !onModelChange}
            disabledReason={!isMain ? "branch" : modelSelectorDisabledReason ?? (busy || submitting ? "busy" : undefined)} onValueChange={changeModel} />
          {modelId && <GenerationSettingsControls modelId={modelId} disabled={!isMain || busy || submitting || changingModel}
            disabledReason={!isMain ? COMPOSER_MODEL_COPY.branchLocked : COMPOSER_MODEL_COPY.busy} />}
        </ComposerActions>
        <ComposerActions className="ms-auto shrink-0">
          <ComposerVoiceButton active={false} aria-label="语音输入" title="语音输入稍后接入" disabled className="size-7 opacity-30" />
          <ComposerSend streaming={busy} idle={!hasQuestion} disabled={busy ? !onStop : submitting || changingModel || !hasQuestion || !attachmentsReady || !onSend}
            onClick={busy ? onStop : () => void submit()} />
        </ComposerActions>
      </ComposerToolbar>
    </ComposerBar>
  </Composer>
}
