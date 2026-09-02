"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { ConversationStore } from "../../core/store"
import type { ProjectedConversationStore } from "../../core/projected-store"
import {
  fromConversationViewThreadId,
  toConversationViewThreadId,
} from "../../core/projections"
import type { CanvasViewState } from "../canvas/use-canvas-layout"
import { useColumnSlots } from "../columns/use-column-slots"
import { useColumnViewport } from "../columns/use-column-viewport"
import type { PlacementMode, Slot } from "../columns/placement"

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Normalized entity runtime + the existing column/canvas workspace behavior. */
export function useNormalizedWorkspace(input: {
  store: ConversationStore
  projectedStore: ProjectedConversationStore
}) {
  const initial = input.store.getState()
  const workspace = initial.workspace
  const { windowWidth, autoColumnCount } = useColumnViewport()
  const [forceCols, setForceCols] = useState<number | null>(
    workspace.forceColumns
  )
  const [mode, setMode] = useState<PlacementMode>(workspace.placementMode)
  const totalCols = forceCols ?? autoColumnCount
  const maxExpanded = totalCols - 1
  const initialSlots: Slot[] = workspace.columnSlots.flatMap((slot) => {
    if (!initial.threadsById[slot.threadId]) return []
    return [
      {
        id: toConversationViewThreadId(initial, slot.threadId),
        folded: slot.folded,
      },
    ]
  })
  const initialWidths = Object.fromEntries(
    Object.entries(workspace.columnWidths).flatMap(([threadId, width]) =>
      initial.threadsById[threadId]
        ? [[toConversationViewThreadId(initial, threadId), width]]
        : []
    )
  )
  const columns = useColumnSlots({
    store: input.projectedStore,
    maxExpanded,
    mode,
    initialSlots,
    initialWidths,
  })

  const [focusNode, setFocusNode] = useState<{ id: string; n: number } | null>(
    null
  )
  const focusSequence = useRef(0)
  const [canvasViewState] = useState<CanvasViewState>(() => ({
    pins: new Map(Object.entries(workspace.canvas.pins)),
  }))

  const setViewMode = useCallback(
    (view: "columns" | "canvas") => {
      input.store.getState().setWorkspace({ view })
      if (view === "columns") setFocusNode(null)
    },
    [input.store]
  )
  const showColumnsView = useCallback(
    () => setViewMode("columns"),
    [setViewMode]
  )
  const focusCanvasNode = useCallback((id: string) => {
    setFocusNode({ id, n: ++focusSequence.current })
  }, [])

  useEffect(() => {
    const state = input.store.getState()
    const nextSlots = columns.slots.map((slot) => ({
      threadId: fromConversationViewThreadId(state, slot.id),
      folded: slot.folded,
    }))
    const nextWidths = Object.fromEntries(
      Object.entries(columns.widths).map(([viewThreadId, width]) => [
        fromConversationViewThreadId(state, viewThreadId),
        width,
      ])
    )
    const nextOpen = nextSlots.map((slot) => slot.threadId)
    const current = state.workspace
    if (
      same(current.columnSlots, nextSlots) &&
      same(current.columnWidths, nextWidths) &&
      same(current.openThreadIds, nextOpen) &&
      current.forceColumns === forceCols &&
      current.placementMode === mode
    )
      return
    state.setWorkspace({
      columnSlots: nextSlots,
      columnWidths: nextWidths,
      openThreadIds: nextOpen,
      forceColumns: forceCols,
      placementMode: mode,
    })
  }, [columns.slots, columns.widths, forceCols, input.store, mode])

  return {
    windowWidth,
    forceCols,
    setForceCols,
    maxExpanded,
    mode,
    setMode,
    columns,
    viewMode: input.store.getState().workspace.view,
    setViewMode,
    focusNode,
    focusCanvasNode,
    showColumnsView,
    canvasViewState,
  }
}
