"use client"

import { useEffect, useRef } from "react"
import {
  GENERATION_CLIENT_POLL_MS,
  GENERATION_ERRORS,
  GENERATION_HIDDEN_POLL_MS,
} from "@/constants/generation"
import { fetchWithAuth } from "@/lib/auth/session-recovery"
import type { ThreadStore } from "../core/store"
import type { GenerationSummary, RecoverableTurn } from "./types"
import {
  initialGenerationIds,
  isGenerationInFlight,
  messageGenerationIds,
  missingGenerationTurn,
  terminalGenerationResultInput,
} from "./generation-reconciliation-logic"

export function useGenerationReconciliation({
  store,
  version,
  initialGenerations,
  registerRecoverableTurn,
}: {
  store: ThreadStore
  version: number
  initialGenerations: GenerationSummary[]
  registerRecoverableTurn(turn: RecoverableTurn): void
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
      for (const generationId of [...generationIdsRef.current]) {
        if (cancelled) return
        try {
          const response = await fetchWithAuth(
            `/api/branch-generations/${generationId}`
          )
          if (response.status === 404) {
            generationIdsRef.current.delete(generationId)
            const recoverable = missingGenerationTurn(
              store.getState(),
              generationId
            )
            if (recoverable) {
              store.failAssistantMessage(
                recoverable.threadId,
                recoverable.assistantMessageId,
                GENERATION_ERRORS.backgroundInterrupted
              )
              registerRecoverableTurn(recoverable)
            }
            continue
          }
          if (!response.ok) continue
          const data = (await response.json()) as {
            generation: GenerationSummary
          }
          if (isGenerationInFlight(data.generation.status)) continue

          generationIdsRef.current.delete(generationId)
          const resultInput = terminalGenerationResultInput(data.generation)
          if (resultInput) store.applyGenerationResult(resultInput)
        } catch (error) {
          console.warn("[thread-chat] generation 轮询失败，将继续重试", error)
        }
      }
      schedule()
    }
    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [store, registerRecoverableTurn])
}
