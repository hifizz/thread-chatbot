"use client"

import { useEffect } from "react"
import { UI_SAVE_DEBOUNCE_MS } from "@/constants/thread-chat"
import type { TreeUiState } from "../net/persist"
import { saveUiState } from "../net/persist"
import { createTreeUiStateSnapshot } from "./ui-state-snapshot"

export function useUiStatePersistence({
  treeId,
  slots,
  widths,
  forceCols,
  mode,
  viewMode,
  isSaveSuppressed,
}: TreeUiState & {
  treeId: string
  isSaveSuppressed(): boolean
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isSaveSuppressed()) return
      saveUiState(
        treeId,
        createTreeUiStateSnapshot({ slots, widths, forceCols, mode, viewMode })
      )
    }, UI_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [treeId, slots, widths, forceCols, mode, viewMode, isSaveSuppressed])
}
