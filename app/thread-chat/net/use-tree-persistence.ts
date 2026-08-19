"use client"

import { useCallback, useEffect, useRef } from "react"
import { TREE_SAVE_DEBOUNCE_MS } from "@/constants/thread-chat"
import type { ThreadStore } from "../core/store"
import { deriveTreeTitle, saveTree } from "./persist"
import { createTreeSaveGate } from "./tree-save-gate"

export function useTreePersistence({
  treeId,
  store,
  version,
  onRevisionConflict,
}: {
  treeId: string
  store: ThreadStore
  version: number
  onRevisionConflict(): void
}) {
  const initialVersionRef = useRef(version)
  const gateRef = useRef(createTreeSaveGate())
  const onRevisionConflictRef = useRef(onRevisionConflict)

  useEffect(() => {
    onRevisionConflictRef.current = onRevisionConflict
  }, [onRevisionConflict])

  useEffect(() => {
    if (version === initialVersionRef.current) return
    gateRef.current.markPending()
    const timer = setTimeout(() => {
      if (!gateRef.current.finishDebounce()) return
      const state = store.getState()
      void saveTree(treeId, state, deriveTreeTitle(state), () => {
        onRevisionConflictRef.current()
      })
    }, TREE_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [version, treeId, store])

  useEffect(
    () => () => {
      if (!gateRef.current.takePendingFlush()) return
      const state = store.getState()
      void saveTree(treeId, state, deriveTreeTitle(state), () => {
        window.location.reload()
      })
    },
    [treeId, store]
  )

  const setTreeSaveSuppressed = useCallback((value: boolean) => {
    gateRef.current.setSuppressed(value)
  }, [])
  const isTreeSaveSuppressed = useCallback(
    () => gateRef.current.isSuppressed(),
    []
  )

  return { setTreeSaveSuppressed, isTreeSaveSuppressed }
}
