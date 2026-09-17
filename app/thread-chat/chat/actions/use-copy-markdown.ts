"use client"

import { useI18n } from "@/lib/i18n/client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MESSAGE_ACTION_ERROR_KEYS } from "./message-action-types"

const COPIED_RESET_MS = 2_000

/** 只复制领域消息的原始 Markdown 字符串，不读取 DOM。 */
export function useCopyMarkdown(onError?: (message: string) => void) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const copy = useCallback(
    async (markdown: string) => {
      try {
        await navigator.clipboard.writeText(markdown)
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
        return true
      } catch {
        setCopied(false)
        onError?.(t(MESSAGE_ACTION_ERROR_KEYS.clipboard))
        return false
      }
    },
    [onError, t]
  )

  return { copied, copy }
}
