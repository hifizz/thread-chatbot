"use client"

import { useState, type ReactNode } from "react"
import { Check, Copy, Pencil, X } from "lucide-react"
import {
  MESSAGE_ACTION_ERRORS,
  MESSAGE_ACTION_LABELS,
  messageActionError,
} from "../actions/message-action-types"
import { MessageToolbar } from "../actions/message-toolbar"
import { useCopyMarkdown } from "../actions/use-copy-markdown"

export function EditableUserMessage({
  markdown,
  editable,
  variantPicker,
  onEdit,
}: {
  markdown: string
  editable: boolean
  variantPicker?: ReactNode
  onEdit: (markdown: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(markdown)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)

  const submit = async () => {
    const text = draft.trim()
    if (!text || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onEdit(text)
      setEditing(false)
    } catch (cause) {
      setError(messageActionError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className={`bubble user-message-body${editing ? "editing" : ""}`}
        data-role="user"
      >
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
                  setDraft(markdown)
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
          markdown
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
              onSelect: () => void copy(markdown),
            },
            {
              key: "edit",
              label: MESSAGE_ACTION_LABELS.edit,
              icon: Pencil,
              onSelect: () => {
                setDraft(markdown)
                setEditing(true)
              },
              disabled: !editable,
              disabledReason: MESSAGE_ACTION_ERRORS.latestUserOnly,
            },
          ]}
        >
          {variantPicker}
        </MessageToolbar>
      )}
      {error && (
        <div className="message-action-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
