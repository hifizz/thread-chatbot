"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { POPUP_EXIT_MS } from "@/constants/thread-chat"
import type { SelectionInfo } from "../branching/selection-bubble"
import type { SwitcherMode } from "./thread-switcher"
import { escapeOverlayTarget, popupPosition } from "./workspace-overlay-logic"
import { SWITCHER_DIMENSIONS } from "./switcher-dimensions"

type ClosingOverlay = { n: number; closing?: boolean }

export function useWorkspaceOverlays() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [switcher, setSwitcher] = useState<
    (SwitcherMode & ClosingOverlay) | null
  >(null)
  const [treeList, setTreeList] = useState<ClosingOverlay | null>(null)
  const [helpPanel, setHelpPanel] = useState<ClosingOverlay | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const switcherSequenceRef = useRef(0)
  const treeListSequenceRef = useRef(0)
  const helpSequenceRef = useRef(0)

  const closeSwitcher = useCallback(() => {
    setSwitcher((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
  }, [])
  const closeTreeList = useCallback(() => {
    setTreeList((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
  }, [])
  const closeHelpPanel = useCallback(() => {
    setHelpPanel((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
  }, [])

  useEffect(() => {
    if (!switcher?.closing) return
    const timer = setTimeout(() => setSwitcher(null), POPUP_EXIT_MS)
    return () => clearTimeout(timer)
  }, [switcher])
  useEffect(() => {
    if (!treeList?.closing) return
    const timer = setTimeout(() => setTreeList(null), POPUP_EXIT_MS)
    return () => clearTimeout(timer)
  }, [treeList])
  useEffect(() => {
    if (!helpPanel?.closing) return
    const timer = setTimeout(() => setHelpPanel(null), POPUP_EXIT_MS)
    return () => clearTimeout(timer)
  }, [helpPanel])

  const toggleGlobalSwitcher = useCallback(() => {
    setSwitcher((current) =>
      current?.kind === "global" && !current.closing
        ? { ...current, closing: true }
        : { kind: "global", n: ++switcherSequenceRef.current }
    )
  }, [])
  const openColumnSwitcher = useCallback(
    (viewportIndex: number, button: HTMLElement) => {
      const rect = button.getBoundingClientRect()
      const dimensions = SWITCHER_DIMENSIONS.column
      const { x, y } = popupPosition({
        right: rect.right,
        bottom: rect.bottom,
        panelWidth: dimensions.width,
        panelHeight: dimensions.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })
      setSwitcher({
        kind: "column",
        vpIndex: viewportIndex,
        x,
        y,
        n: ++switcherSequenceRef.current,
      })
    },
    []
  )
  const openSubtree = useCallback((rootId: string, button: HTMLElement) => {
    const rect = button.getBoundingClientRect()
    const dimensions = SWITCHER_DIMENSIONS.subtree
    const { x, y } = popupPosition({
      right: rect.right,
      bottom: rect.bottom,
      panelWidth: dimensions.width,
      panelHeight: dimensions.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    setSwitcher({
      kind: "subtree",
      rootId,
      x,
      y,
      n: ++switcherSequenceRef.current,
    })
  }, [])
  const toggleTreeList = useCallback(() => {
    setTreeList((current) =>
      current && !current.closing
        ? { ...current, closing: true }
        : { n: ++treeListSequenceRef.current }
    )
  }, [])
  const openHelpPanel = useCallback(() => {
    setHelpPanel({ n: ++helpSequenceRef.current })
  }, [])
  const openArtifact = useCallback((artifactId: string) => {
    setActiveArtifactId(artifactId)
    setDrawerOpen(true)
  }, [])
  const toggleDrawer = useCallback(() => {
    setDrawerOpen((open) => !open)
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (event.shiftKey) toggleTreeList()
        else toggleGlobalSwitcher()
        return
      }
      if (event.key !== "Escape") return

      const target = escapeOverlayTarget({
        helpOpen: Boolean(helpPanel && !helpPanel.closing),
        treeListOpen: Boolean(treeList && !treeList.closing),
        selectionOpen: Boolean(selection),
        switcherOpen: Boolean(switcher && !switcher.closing),
        drawerOpen,
      })
      if (target === "help") closeHelpPanel()
      else if (target === "tree-list") closeTreeList()
      else if (target === "selection") setSelection(null)
      else if (target === "switcher") closeSwitcher()
      else if (target === "drawer") closeDrawer()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [
    selection,
    switcher,
    drawerOpen,
    treeList,
    helpPanel,
    toggleGlobalSwitcher,
    toggleTreeList,
    closeSwitcher,
    closeTreeList,
    closeHelpPanel,
    closeDrawer,
  ])

  return {
    rootRef,
    selection,
    setSelection,
    switcher,
    closeSwitcher,
    toggleGlobalSwitcher,
    openColumnSwitcher,
    openSubtree,
    treeList,
    closeTreeList,
    toggleTreeList,
    helpPanel,
    closeHelpPanel,
    openHelpPanel,
    drawerOpen,
    activeArtifactId,
    setActiveArtifactId,
    openArtifact,
    toggleDrawer,
    closeDrawer,
  }
}
