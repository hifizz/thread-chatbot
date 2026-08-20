"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import type { ThreadStore } from "../core/store"
import type { ThreadMessageActionCommands } from "../chat/message-action-commands"
import type { ChatController } from "../net/chat-controller"
import type { TreeUiState, ViewMode } from "../net/persist"
import type { CanvasChatActions } from "./canvas-actions"
import type { CanvasViewState } from "./use-canvas-layout"
import { useColumnSlots } from "./use-column-slots"
import { useColumnViewport } from "./use-column-viewport"
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
  const { windowWidth, autoColumnCount } = useColumnViewport()
  const [forceCols, setForceCols] = useState<number | null>(
    initialUi?.forceCols ?? null
  )
  const totalCols = forceCols ?? autoColumnCount
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

  const canvasChat = useMemo<CanvasChatActions>(
    () => ({
      send: chat.send,
      stop: chat.stop,
      retry: chat.retry,
      retryAssistant: messageCommands.retryAssistant,
      retryUserTurn: messageCommands.retryUserTurn,
      editAndRegenerate: messageCommands.editAndRegenerate,
      switchTurnVariant: messageCommands.switchTurnVariant,
      submitFeedback: messageCommands.submitFeedback,
    }),
    [chat, messageCommands]
  )
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
