"use client"

import { useState } from "react"
import { Check, Copy, Pencil, RotateCcw, X } from "lucide-react"
import {
  MESSAGE_ACTION_ERRORS,
  MESSAGE_ACTION_LABELS,
  type EditableUserMessageProps,
} from "./message-action-types"
import { MessageToolbar } from "./message-toolbar"
import { useCopyMarkdown } from "./use-copy-markdown"

export function EditableUserMessage({
  threadId,
  message,
  editable,
  recovery,
  commands,
}: EditableUserMessageProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)

  const submit = async () => {
    const text = draft.trim()
    if (!text || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await commands.editAndRegenerate(threadId, message.id, text)
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
        className={`bubble user-message-body${editing ? "editing" : ""}`}
        data-role="user"
      >
        {message.quote && <div className="msg-quote">{message.quote.text}</div>}
        {editing ? (
          <>
            <textarea
              value={draft}
              aria-label="编辑用户消息"
              disabled={submitting}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="user-edit-actions">
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setDraft(message.text)
                  setError(null)
                }}
                disabled={submitting}
              >
                <X size={14} />
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void submit()}
                disabled={submitting || draft.trim() === ""}
              >
                {submitting ? "提交中…" : "发送"}
              </button>
            </div>
          </>
        ) : (
          message.text
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
              onSelect: () => void copy(message.text),
            },
            {
              key: "edit",
              label: MESSAGE_ACTION_LABELS.edit,
              icon: Pencil,
              onSelect: () => {
                setDraft(message.text)
                setEditing(true)
              },
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
          <button type="button" onClick={() => setEditing(true)}>
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
