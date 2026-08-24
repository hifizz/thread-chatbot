"use client"

import { useState } from "react"
import {
  Check,
  Copy,
  GitFork,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import {
  MESSAGE_ACTION_ERRORS,
  MESSAGE_ACTION_LABELS,
  messageActionError,
  type MessageActionFeedback,
} from "./message-action-types"
import { MessageToolbar } from "./message-toolbar"
import { useCopyMarkdown } from "./use-copy-markdown"

export function AssistantMessageToolbar({
  markdown,
  regeneratable,
  feedbackEnabled,
  feedback,
  forkLabel,
  onFork,
  onRegenerate,
  onFeedback,
}: {
  markdown: string
  regeneratable: boolean
  feedbackEnabled: boolean
  feedback: MessageActionFeedback
  forkLabel: string
  onFork: () => void
  onRegenerate: () => Promise<void>
  onFeedback: (feedback: MessageActionFeedback) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)

  const regenerate = async () => {
    setBusy("regenerate")
    setError(null)
    try {
      await onRegenerate()
    } catch (cause) {
      setError(messageActionError(cause))
    } finally {
      setBusy(null)
    }
  }

  const submitFeedback = async (next: MessageActionFeedback) => {
    setBusy(next ?? feedback ?? "clear")
    setError(null)
    try {
      await onFeedback(next)
    } catch (cause) {
      setError(messageActionError(cause) || MESSAGE_ACTION_ERRORS.feedbackSave)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <MessageToolbar
        align="start"
        actions={[
          {
            key: "copy",
            label: copied
              ? MESSAGE_ACTION_LABELS.copied
              : MESSAGE_ACTION_LABELS.copy,
            icon: copied ? Check : Copy,
            onSelect: () => void copy(markdown),
            disabled: markdown.trim() === "",
            disabledReason: MESSAGE_ACTION_ERRORS.noMarkdown,
          },
          {
            key: "fork",
            label: forkLabel,
            icon: GitFork,
            onSelect: onFork,
          },
          {
            key: "regenerate",
            label: MESSAGE_ACTION_LABELS.regenerate,
            icon: RotateCcw,
            onSelect: () => void regenerate(),
            busy: busy === "regenerate",
            disabled: !regeneratable,
            disabledReason: MESSAGE_ACTION_ERRORS.latestAssistantOnly,
          },
          {
            key: "positive",
            label: MESSAGE_ACTION_LABELS.positive,
            icon: ThumbsUp,
            onSelect: () =>
              void submitFeedback(feedback === "positive" ? null : "positive"),
            pressed: feedback === "positive",
            busy: busy === "positive",
            disabled: !feedbackEnabled,
            disabledReason: MESSAGE_ACTION_ERRORS.incompleteFeedback,
          },
          {
            key: "negative",
            label: MESSAGE_ACTION_LABELS.negative,
            icon: ThumbsDown,
            onSelect: () =>
              void submitFeedback(feedback === "negative" ? null : "negative"),
            pressed: feedback === "negative",
            busy: busy === "negative",
            disabled: !feedbackEnabled,
            disabledReason: MESSAGE_ACTION_ERRORS.incompleteFeedback,
          },
        ]}
      />
      {error && (
        <div className="message-action-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
