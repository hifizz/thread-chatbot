"use client"

import { useCallback, useRef, useState } from "react"
import type { ThreadStore } from "../core/store"
import type {
  ChatController,
  ThreadMessageActionCommands,
} from "../net/chat-controller"
import type { TreeUiState, ViewMode } from "../net/persist"
import type { CanvasChatActions } from "./canvas-node"
import type { CanvasViewState } from "./use-canvas-layout"
import { COL_MIN_W, useWindowWidth } from "./thread-columns"
import { useColumnSlots } from "./use-column-slots"
import type { PlacementMode } from "./placement"
import { useUiStatePersistence } from "./use-ui-state-persistence"

/** 列/画布工作台的响应式状态、持久化与画布命令适配组合。 */
export function useThreadChatWorkspace({
  treeId,
  store,
  chat,
  messageCommands,
  initialUi,
  isSaveSuppressed,
}: {
  treeId: string
  store: ThreadStore
  chat: ChatController
  messageCommands: ThreadMessageActionCommands
  initialUi: TreeUiState | null
  isSaveSuppressed(): boolean
}) {
  const windowWidth = useWindowWidth()
  const [forceCols, setForceCols] = useState<number | null>(
    initialUi?.forceCols ?? null
  )
  const autoCols =
    windowWidth === null
      ? 3
      : Math.max(2, Math.min(4, Math.floor(windowWidth / COL_MIN_W)))
  const totalCols = forceCols ?? autoCols
  const maxExpanded = totalCols - 1
  const [mode, setMode] = useState<PlacementMode>(initialUi?.mode ?? "replace")
  const columns = useColumnSlots({
    store,
    maxExpanded,
    mode,
    initialSlots: initialUi?.slots,
    initialWidths: initialUi?.widths,
  })

  const [viewMode, setViewMode] = useState<ViewMode>(
    initialUi?.viewMode ?? "columns"
  )
  const [focusNode, setFocusNode] = useState<{ id: string; n: number } | null>(
    null
  )
  const focusSequence = useRef(0)
  const showColumnsView = useCallback(() => {
    setViewMode("columns")
    setFocusNode(null)
  }, [])
  const focusCanvasNode = useCallback((id: string) => {
    setFocusNode({ id, n: ++focusSequence.current })
  }, [])

  const [canvasChat] = useState<CanvasChatActions>(() => ({
    send: chat.send,
    stop: chat.stop,
    retry: chat.retry,
    retryAssistant: messageCommands.retryAssistant,
    retryUserTurn: messageCommands.retryUserTurn,
    editAndRegenerate: messageCommands.editAndRegenerate,
    switchTurnVariant: messageCommands.switchTurnVariant,
    submitFeedback: messageCommands.submitFeedback,
  }))
  const [canvasViewState] = useState<CanvasViewState>(() => ({
    pins: new Map(),
  }))

  useUiStatePersistence({
    treeId,
    slots: columns.slots,
    widths: columns.widths,
    forceCols,
    mode,
    viewMode,
    isSaveSuppressed,
  })

  return {
    windowWidth,
    forceCols,
    setForceCols,
    maxExpanded,
    mode,
    setMode,
    columns,
    viewMode,
    setViewMode,
    focusNode,
    focusCanvasNode,
    showColumnsView,
    canvasChat,
    canvasViewState,
  }
}
