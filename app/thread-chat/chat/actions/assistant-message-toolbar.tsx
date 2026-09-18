"use client"

import { useI18n } from "@/lib/i18n/client"

import { useState } from "react"
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react"
import {
  MESSAGE_ACTION_ERROR_KEYS,
  MESSAGE_ACTION_LABEL_KEYS,
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
  const { t } = useI18n()
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

  const submitFeedback = async (next: typeof feedback) => {
    setBusy(next ?? feedback ?? "clear")
    setError(null)
    try {
      await commands.submitFeedback(threadId, message.id, next ?? null)
    } catch {
      setError(t(MESSAGE_ACTION_ERROR_KEYS.feedbackSave))
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
              ? t(MESSAGE_ACTION_LABEL_KEYS.copied)
              : t(MESSAGE_ACTION_LABEL_KEYS.copy),
            icon: copied ? Check : Copy,
            onSelect: () => void copy(message.text),
            disabled: message.text.trim() === "",
            disabledReason: t(MESSAGE_ACTION_ERROR_KEYS.noMarkdown),
          },
          {
            key: "regenerate",
            label: t(MESSAGE_ACTION_LABEL_KEYS.regenerate),
            icon: RotateCcw,
            onSelect: () => void regenerate(),
            busy: busy === "regenerate",
            disabled: !regeneratable,
            disabledReason: t(MESSAGE_ACTION_ERROR_KEYS.latestAssistantOnly),
          },
          {
            key: "positive",
            label: t(MESSAGE_ACTION_LABEL_KEYS.positive),
            icon: ThumbsUp,
            onSelect: () =>
              void submitFeedback(
                feedback === "positive" ? undefined : "positive"
              ),
            pressed: feedback === "positive",
            busy: busy === "positive",
          },
          {
            key: "negative",
            label: t(MESSAGE_ACTION_LABEL_KEYS.negative),
            icon: ThumbsDown,
            onSelect: () =>
              void submitFeedback(
                feedback === "negative" ? undefined : "negative"
              ),
            pressed: feedback === "negative",
            busy: busy === "negative",
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
