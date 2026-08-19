"use client"

import { useEffect, useState } from "react"
import type { MessageFeedbackSummary, ThreadTreeState } from "../core/types"
import type { GenerationSummary, RecoverableTurn } from "../generation/types"
import {
  loadTree,
  loadUiState,
  rememberTreeId,
  type TreeUiState,
} from "./persist"
import { threadChatBootSeed } from "./thread-chat-boot"

export interface ThreadChatBoot {
  seed: ThreadTreeState
  ui: TreeUiState | null
  customTitle: string | null
  generations: GenerationSummary[]
  messageFeedbacks: MessageFeedbackSummary[]
  recoverableTurns: RecoverableTurn[]
}

export function useThreadChatBoot(treeId: string): ThreadChatBoot | null {
  const [boot, setBoot] = useState<ThreadChatBoot | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadTree(treeId)
      const seed = threadChatBootSeed(loaded)
      const ui = loadUiState(treeId, seed)
      if (cancelled) return
      rememberTreeId(treeId)
      setBoot({
        seed,
        ui,
        customTitle: loaded.customTitle,
        generations: loaded.generations,
        messageFeedbacks: loaded.messageFeedbacks,
        recoverableTurns: loaded.recoverableTurns,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [treeId])

  return boot
}
