"use client"

import { useState } from "react"
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react"
import type { GenerationFeedback } from "../generation/types"
import {
  MESSAGE_ACTION_ERRORS,
  MESSAGE_ACTION_LABELS,
  type AssistantMessageToolbarProps,
} from "./message-action-types"
import { MessageToolbar } from "./message-toolbar"
import { useCopyMarkdown } from "./use-copy-markdown"

export function AssistantMessageToolbar({
  threadId,
  message,
  regeneratable,
  feedback,
  commands,
}: AssistantMessageToolbarProps) {
  const [selected, setSelected] = useState<GenerationFeedback | undefined>(
    feedback
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)

  const regenerate = async () => {
    setBusy("regenerate")
    setError(null)
    const result = await commands.retryAssistant(threadId, message.id)
    setBusy(null)
    if (!result.ok) setError(result.message)
  }

  const submitFeedback = async (next: GenerationFeedback | undefined) => {
    if (!message.generationId) return
    const previous = selected
    setSelected(next)
    setBusy(next ?? selected ?? "clear")
    setError(null)
    try {
      await commands.submitFeedback(message.generationId, next ?? null)
    } catch {
      setSelected(previous)
      setError(MESSAGE_ACTION_ERRORS.feedbackSave)
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
            onSelect: () => void copy(message.text),
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
              void submitFeedback(
                selected === "positive" ? undefined : "positive"
              ),
            pressed: selected === "positive",
            busy: busy === "positive",
            disabled: !message.generationId,
            disabledReason: MESSAGE_ACTION_ERRORS.feedbackUnavailable,
          },
          {
            key: "negative",
            label: MESSAGE_ACTION_LABELS.negative,
            icon: ThumbsDown,
            onSelect: () =>
              void submitFeedback(
                selected === "negative" ? undefined : "negative"
              ),
            pressed: selected === "negative",
            busy: busy === "negative",
            disabled: !message.generationId,
            disabledReason: MESSAGE_ACTION_ERRORS.feedbackUnavailable,
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
