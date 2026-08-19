"use client"

import { useEffect, useRef } from "react"
import {
  GENERATION_CLIENT_POLL_MS,
  GENERATION_HIDDEN_POLL_MS,
} from "@/constants/generation"
import { resolveThreadChatModelId } from "@/constants/model"
import { fetchWithAuth } from "@/lib/auth/session-recovery"
import type { MessageFeedbackSummary } from "../core/types"
import type { ThreadStore } from "../core/store"
import type { GenerationSummary, RecoverableTurn } from "./types"
import {
  initialGenerationIds,
  isGenerationInFlight,
  messageGenerationIds,
} from "./generation-reconciliation-logic"
import { loadTree, sanitizeLoadedState } from "../net/persist"

export function useGenerationReconciliation({
  treeId,
  store,
  version,
  initialGenerations,
  replacePersistedMessageActions,
}: {
  treeId: string
  store: ThreadStore
  version: number
  initialGenerations: GenerationSummary[]
  replacePersistedMessageActions(input: {
    recoverableTurns: RecoverableTurn[]
    messageFeedbacks: MessageFeedbackSummary[]
  }): void
}) {
  const generationIdsRef = useRef(initialGenerationIds(initialGenerations))

  useEffect(() => {
    for (const generationId of messageGenerationIds(store.getState()))
      generationIdsRef.current.add(generationId)
  }, [version, store])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = () => {
      if (cancelled) return
      timer = setTimeout(
        poll,
        document.hidden ? GENERATION_HIDDEN_POLL_MS : GENERATION_CLIENT_POLL_MS
      )
    }
    const poll = async () => {
      let needsTreeReconciliation = false
      for (const generationId of [...generationIdsRef.current]) {
        if (cancelled) return
        try {
          const response = await fetchWithAuth(
            `/api/branch-generations/${generationId}`
          )
          if (response.status === 404) {
            generationIdsRef.current.delete(generationId)
            needsTreeReconciliation = true
            continue
          }
          if (!response.ok) continue
          const data = (await response.json()) as {
            generation: GenerationSummary
          }
          if (isGenerationInFlight(data.generation.status)) continue

          generationIdsRef.current.delete(generationId)
          needsTreeReconciliation = true
        } catch (error) {
          console.warn("[thread-chat] generation 轮询失败，将继续重试", error)
        }
      }
      if (needsTreeReconciliation && !cancelled) {
        const loaded = await loadTree(treeId)
        if (loaded.state) {
          store.replaceReconciledState(
            sanitizeLoadedState(
              loaded.state,
              resolveThreadChatModelId,
              loaded.generations
            )
          )
          replacePersistedMessageActions({
            recoverableTurns: loaded.recoverableTurns,
            messageFeedbacks: loaded.messageFeedbacks,
          })
        }
      }
      schedule()
    }
    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [store, treeId, replacePersistedMessageActions])
}
