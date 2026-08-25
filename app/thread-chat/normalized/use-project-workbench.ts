"use client"

import { useEffect, useRef } from "react"
import {
  createWorkbenchSnapshot,
  parseWorkbenchSnapshot,
  projectWorkbenchStorageKey,
} from "@/lib/thread-chat/client/workbench-persistence"
import type { ThreadChatProjectRuntime } from "@/lib/thread-chat/client/types"

const SAVE_DELAY_MS = 180

export function useProjectWorkbench(
  runtime: ThreadChatProjectRuntime,
  bootstrapReady: boolean
) {
  const restored = useRef(false)

  useEffect(() => {
    if (!bootstrapReady || restored.current) return
    restored.current = true
    const snapshot = parseWorkbenchSnapshot(
      window.localStorage.getItem(projectWorkbenchStorageKey(runtime.projectId))
    )
    if (snapshot) runtime.store.getState().restoreWorkbenchSnapshot(snapshot)
    else runtime.store.getState().resetWorkbenchToDefault()
  }, [bootstrapReady, runtime])

  useEffect(() => {
    if (!bootstrapReady || !restored.current) return
    let timer: number | null = null
    const save = () => {
      timer = null
      window.localStorage.setItem(
        projectWorkbenchStorageKey(runtime.projectId),
        JSON.stringify(createWorkbenchSnapshot(runtime.store.getState()))
      )
    }
    const unsubscribe = runtime.store.subscribe(() => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(save, SAVE_DELAY_MS)
    })
    return () => {
      unsubscribe()
      if (timer !== null) {
        window.clearTimeout(timer)
        save()
      }
    }
  }, [bootstrapReady, runtime])
}
