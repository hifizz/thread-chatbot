"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { POPUP_EXIT_MS } from "@/constants/thread-chat"
import {
  WORKSPACE_DRAWER,
  WORKSPACE_DRAWER_EXIT_MS,
} from "@/constants/workspace-drawers"
import type { SelectionInfo } from "../../branching/selection/selection-bubble"
import type { SwitcherMode } from "../navigation/thread-switcher"
import { SWITCHER_DIMENSIONS } from "../navigation/switcher-dimensions"
import type { OpenArtifactOptions } from "../artifacts/artifact-open"
import {
  closeLayer,
  drawerSideForAnchor,
  escapeOverlayTarget,
  isNarrowDrawerViewport,
  openLayer,
  popupPosition,
  topLayer,
  type DrawerId,
  type DrawerSide,
  type TransientOverlayId,
} from "./workspace-overlay-logic"

type ClosingOverlay = { n: number; closing?: boolean }

export function useWorkspaceOverlays() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [switcher, setSwitcher] = useState<
    (SwitcherMode & ClosingOverlay) | null
  >(null)
  const [treeList, setTreeList] = useState<ClosingOverlay | null>(null)
  const [helpPanel, setHelpPanel] = useState<ClosingOverlay | null>(null)
  const [drawerStack, setDrawerStack] = useState<DrawerId[]>([])
  const [closingDrawers, setClosingDrawers] = useState<
    Partial<Record<DrawerId, boolean>>
  >({})
  const [artifactSide, setArtifactSide] = useState<DrawerSide>("right")
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [narrowDrawers, setNarrowDrawers] = useState(false)
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
  const closeTransientOverlays = useCallback(() => {
    closeSwitcher()
    closeTreeList()
    closeHelpPanel()
  }, [closeHelpPanel, closeSwitcher, closeTreeList])

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
  useEffect(() => {
    const update = () =>
      setNarrowDrawers(isNarrowDrawerViewport(window.innerWidth))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const toggleGlobalSwitcher = useCallback(() => {
    setTreeList((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
    setHelpPanel((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
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
      closeTransientOverlays()
      setSwitcher({
        kind: "column",
        vpIndex: viewportIndex,
        x,
        y,
        n: ++switcherSequenceRef.current,
      })
    },
    [closeTransientOverlays]
  )
  const openSubtree = useCallback(
    (rootId: string, button: HTMLElement) => {
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
      closeTransientOverlays()
      setSwitcher({
        kind: "subtree",
        rootId,
        x,
        y,
        n: ++switcherSequenceRef.current,
      })
    },
    [closeTransientOverlays]
  )
  const toggleTreeList = useCallback(() => {
    setSwitcher((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
    setHelpPanel((current) =>
      current && !current.closing ? { ...current, closing: true } : current
    )
    setTreeList((current) =>
      current && !current.closing
        ? { ...current, closing: true }
        : { n: ++treeListSequenceRef.current }
    )
  }, [])
  const openHelpPanel = useCallback(() => {
    closeTransientOverlays()
    setHelpPanel({ n: ++helpSequenceRef.current })
  }, [closeTransientOverlays])

  const activateDrawer = useCallback((id: DrawerId) => {
    setClosingDrawers((current) => ({ ...current, [id]: false }))
    setDrawerStack((current) => openLayer(current, id))
  }, [])
  const openDrawer = useCallback(
    (id: DrawerId) => {
      if (narrowDrawers) {
        const other: DrawerId = id === "project" ? "artifacts" : "project"
        setClosingDrawers((current) => ({ ...current, [other]: true }))
      }
      activateDrawer(id)
    },
    [activateDrawer, narrowDrawers]
  )
  const closeDrawer = useCallback((id: DrawerId) => {
    setClosingDrawers((current) => ({ ...current, [id]: true }))
  }, [])
  const toggleDrawer = useCallback(
    (id: DrawerId) => {
      setDrawerStack((current) => {
        const activeStack = current.filter((item) => !closingDrawers[item])
        if (current.includes(id) && !closingDrawers[id]) {
          if (topLayer(activeStack) === id) {
            setClosingDrawers((closing) => ({ ...closing, [id]: true }))
            return current
          }
          return openLayer(current, id)
        }
        if (narrowDrawers) {
          const other: DrawerId = id === "project" ? "artifacts" : "project"
          setClosingDrawers((closing) => ({
            ...closing,
            [other]: true,
            [id]: false,
          }))
        } else {
          setClosingDrawers((closing) => ({ ...closing, [id]: false }))
        }
        return openLayer(current, id)
      })
    },
    [closingDrawers, narrowDrawers]
  )
  const completeDrawerClose = useCallback((id: DrawerId) => {
    setDrawerStack((current) => closeLayer(current, id))
    setClosingDrawers((current) => ({ ...current, [id]: false }))
  }, [])
  useEffect(() => {
    const timers = (Object.keys(closingDrawers) as DrawerId[]).flatMap((id) =>
      closingDrawers[id]
        ? [
            window.setTimeout(
              () => completeDrawerClose(id),
              WORKSPACE_DRAWER_EXIT_MS
            ),
          ]
        : []
    )
    return () => timers.forEach(window.clearTimeout)
  }, [closingDrawers, completeDrawerClose])

  const openArtifact = useCallback(
    (
      artifactId: string,
      options: OpenArtifactOptions,
      drawerWidth?: number
    ) => {
      setActiveArtifactId(artifactId || null)
      if (!drawerStack.includes("artifacts")) {
        const side =
          options.source === "pointer" && options.anchorRect
            ? drawerSideForAnchor({
                anchorLeft: options.anchorRect.left,
                anchorRight: options.anchorRect.right,
                viewportWidth: window.innerWidth,
                drawerWidth:
                  drawerWidth ??
                  WORKSPACE_DRAWER.artifactDefaultWidth,
              })
            : "right"
        setArtifactSide(side)
      }
      openDrawer("artifacts")
    },
    [drawerStack, openDrawer]
  )

  const transientStack = useMemo(() => {
    const entries: Array<{ id: TransientOverlayId; n: number }> = []
    if (helpPanel && !helpPanel.closing)
      entries.push({ id: "help", n: helpPanel.n })
    if (treeList && !treeList.closing)
      entries.push({ id: "tree-list", n: treeList.n })
    if (switcher && !switcher.closing)
      entries.push({ id: "switcher", n: switcher.n })
    if (selection) entries.push({ id: "selection", n: Number.MAX_SAFE_INTEGER })
    return entries
      .sort((left, right) => left.n - right.n)
      .map((entry) => entry.id)
  }, [helpPanel, selection, switcher, treeList])
  const escapeStateRef = useRef({
    transientStack,
    drawerStack,
    closingDrawers,
  })
  useLayoutEffect(() => {
    escapeStateRef.current = { transientStack, drawerStack, closingDrawers }
  }, [transientStack, drawerStack, closingDrawers])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (event.shiftKey) toggleTreeList()
        else toggleGlobalSwitcher()
        return
      }
      if (event.key !== "Escape") return
      const current = escapeStateRef.current
      const target = escapeOverlayTarget({
        transientStack: current.transientStack,
        drawerStack: current.drawerStack.filter(
          (id) => !current.closingDrawers[id]
        ),
        isComposing: event.isComposing,
        repeat: event.repeat,
      })
      if (!target) return
      if (target.kind === "transient") {
        if (target.id === "help") closeHelpPanel()
        else if (target.id === "tree-list") closeTreeList()
        else if (target.id === "selection") setSelection(null)
        else closeSwitcher()
      } else if (target.kind === "drawer") closeDrawer(target.id)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [
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
    drawerStack,
    closingDrawers,
    narrowDrawers,
    artifactSide,
    activeArtifactId,
    setActiveArtifactId,
    openArtifact,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    activateDrawer,
    completeDrawerClose,
    drawerOpen: drawerStack.includes("artifacts") && !closingDrawers.artifacts,
    toggleArtifactsDrawer: () => toggleDrawer("artifacts"),
    closeArtifactsDrawer: () => closeDrawer("artifacts"),
    topDrawer: topLayer(drawerStack.filter((id) => !closingDrawers[id])),
  }
}
