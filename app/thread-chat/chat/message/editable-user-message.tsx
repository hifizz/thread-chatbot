"use client"

import { useState } from "react"
import { Check, Copy, Pencil, RotateCcw, X } from "lucide-react"
import {
  MESSAGE_ACTION_ERRORS,
  MESSAGE_ACTION_LABELS,
  type EditableUserMessageProps,
} from "../actions/message-action-types"
import { MessageToolbar } from "../actions/message-toolbar"
import { useCopyMarkdown } from "../actions/use-copy-markdown"
import { InlineArtifactEditor } from "../composer/inline-artifact-editor"
import { inlineComposerText } from "../composer/inline-editor-document"
import type { InlineComposerPart } from "@/lib/thread-chat/contracts/artifact-reference"
import { messagePartsToContent } from "@/lib/thread-chat/contracts/message-content"
import { inlineComposerPartsEqual } from "@/lib/thread-chat/inline-composer"
import { UserMessageContent } from "./user-message-content"

export function EditableUserMessage({
  threadId,
  message,
  editable,
  recovery,
  commands,
}: EditableUserMessageProps) {
  const [editing, setEditing] = useState(false)
  const originalParts = message.uiParts ? messagePartsToContent(message.uiParts) : [{ type: "text" as const, text: message.text }]
  const initialParts = originalParts.filter((part): part is InlineComposerPart => part.type === "text" || part.type === "artifact-reference")
  const titles = Object.fromEntries((message.uiParts ?? []).flatMap((part) => part.type === "data-artifact-reference"
    ? [[part.data.artifactId, part.data.title]] : []))
  const [draft, setDraft] = useState<InlineComposerPart[]>(initialParts)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)
  const hasChanges = !inlineComposerPartsEqual(draft, initialParts)
  const canSubmit = hasChanges && !submitting && inlineComposerText(draft).trim() !== ""

  const startEditing = () => {
    setDraft(initialParts)
    setError(null)
    setEditing(true)
  }

  const submit = async () => {
    if (!canSubmit) return
    const text = inlineComposerText(draft).trim()
    setSubmitting(true)
    setError(null)
    const result = await commands.editAndRegenerate(threadId, message.id, text, [
      ...originalParts.filter((part) => part.type === "quote"),
      ...draft,
      ...originalParts.filter((part) => part.type === "file"),
    ])
    setSubmitting(false)
    if (result.ok) setEditing(false)
    else setError(result.message)
  }

  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    setError(null)
    const result = await commands.retryUserTurn(threadId, message.id)
    setRetrying(false)
    if (!result.ok) setError(result.message)
  }

  return (
    <>
      <div
        className={`bubble user-message-body${editing ? " editing" : ""}`}
        data-role="user"
      >
        {editing ? (
          <>
            {message.quote && <div className="msg-quote">{message.quote.text}</div>}
            <InlineArtifactEditor
              value={draft}
              onChange={setDraft}
              label="编辑用户消息"
              disabled={submitting}
              titles={titles}
              onSubmit={() => void submit()}
              submitMode="mod-enter"
              autoFocus
            />
            <div className="user-edit-actions">
              <button
                type="button"
                className={!hasChanges ? "default-action" : undefined}
                onClick={() => {
                  setEditing(false)
                  setDraft(initialParts)
                  setError(null)
                }}
                disabled={submitting}
              >
                <X size={14} />
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {submitting ? "提交中…" : "发送"}
              </button>
            </div>
          </>
        ) : (
          <UserMessageContent key={message.id} message={message} />
        )}
      </div>
      {!editing && (
        <MessageToolbar
          align="end"
          actions={[
            {
              key: "copy",
              label: copied
                ? MESSAGE_ACTION_LABELS.copied
                : MESSAGE_ACTION_LABELS.copy,
              icon: copied ? Check : Copy,
              onSelect: () => void copy(message.uiParts
                ? message.uiParts.map((part) => part.type === "text" ? part.text : part.type === "data-artifact-reference" ? `@${part.data.title}` : "").join("")
                : message.text),
            },
            {
              key: "edit",
              label: MESSAGE_ACTION_LABELS.edit,
              icon: Pencil,
              onSelect: startEditing,
              disabled: !editable,
              disabledReason: MESSAGE_ACTION_ERRORS.latestUserOnly,
            },
          ]}
        />
      )}
      {recovery && (
        <div className="recoverable-turn" role="status">
          <span>这条消息没有可恢复的 AI 回复。</span>
          <button
            type="button"
            disabled={retrying}
            onClick={() => void retry()}
          >
            <RotateCcw size={13} />
            {retrying ? "重试中…" : "重试"}
          </button>
          <button type="button" onClick={startEditing}>
            <Pencil size={13} />
            编辑后重试
          </button>
        </div>
      )}
      {error && (
        <div className="message-action-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
