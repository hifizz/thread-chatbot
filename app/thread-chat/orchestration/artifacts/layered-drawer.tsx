"use client"

import { Drawer } from "@base-ui/react/drawer"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { WORKSPACE_DRAWER } from "@/constants/workspace-drawers"
import type { WorkspacePanelSizes, WorkspaceUiState } from "../../core/types"
import {
  clampArtifactDrawerWidth,
  type DrawerSide,
} from "../overlays/workspace-overlay-logic"

function focusable(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.closest("[inert]")) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function fallbackFocus(): HTMLElement | null {
  const topClose = document.querySelector<HTMLElement>(
    '[data-layered-drawer-top="true"] [data-layered-drawer-close]'
  )
  if (focusable(topClose)) return topClose
  const topbarControl = document.querySelector<HTMLElement>(
    ".tc .topbar button:not(:disabled)"
  )
  return focusable(topbarControl) ? topbarControl : null
}

export interface LayeredDrawerProps {
  open: boolean
  zIndex: number
  side: DrawerSide
  topLayer?: boolean
  onActivate(): void
  onClose(): void
  onOpenChangeComplete?(open: boolean): void
  children: ReactNode
  className?: string
  container?: HTMLElement | null | RefObject<HTMLElement | null>
  initialWidth?: number
  resizable?: boolean
  narrow?: boolean
  onWidthCommit?(width: number): void
  onWidthReset?(): void
  panelSizes?: WorkspacePanelSizes
  setWorkspace?(next: Partial<WorkspaceUiState>): void
}

export function LayeredDrawer({
  open,
  zIndex,
  side,
  topLayer = true,
  onActivate,
  onClose,
  onOpenChangeComplete,
  children,
  className = "",
  container,
  initialWidth,
  resizable = false,
  narrow = false,
  onWidthCommit,
  onWidthReset,
  panelSizes,
  setWorkspace,
}: LayeredDrawerProps) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const wasOpenRef = useRef(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    currentWidth: number
  } | null>(null)
  const defaultWidth = WORKSPACE_DRAWER.artifactDefaultWidth
  const [width, setWidth] = useState(
    initialWidth ?? panelSizes?.artifactDrawer ?? defaultWidth
  )

  useEffect(() => {
    if (initialWidth !== undefined && !dragRef.current) setWidth(initialWidth)
  }, [initialWidth])

  useLayoutEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    triggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    wasOpenRef.current = true
    queueMicrotask(() =>
      popupRef.current
        ?.querySelector<HTMLElement>("[data-layered-drawer-close]")
        ?.focus()
    )
  }, [open])
  const restoreFocus = useCallback(() => {
    const target = focusable(triggerRef.current)
      ? triggerRef.current
      : fallbackFocus()
    target?.focus()
  }, [])
  const commitWidth = useCallback(
    (next: number) => {
      onWidthCommit?.(next)
      if (setWorkspace) {
        setWorkspace({
          panelSizes: { ...panelSizes, artifactDrawer: next },
        })
      }
    },
    [onWidthCommit, panelSizes, setWorkspace]
  )
  const resetWidth = useCallback(() => {
    setWidth(WORKSPACE_DRAWER.artifactDefaultWidth)
    onWidthReset?.()
    if (setWorkspace) {
      const nextPanelSizes = { ...panelSizes }
      delete nextPanelSizes.artifactDrawer
      setWorkspace({ panelSizes: nextPanelSizes })
    }
  }, [onWidthReset, panelSizes, setWorkspace])
  const commitKeyboardWidth = useCallback(
    (next: number) => {
      setWidth(next)
      commitWidth(next)
    },
    [commitWidth]
  )
  const onResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Home") {
        event.preventDefault()
        resetWidth()
        return
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      event.preventDefault()
      const direction = event.key === "ArrowRight" ? 1 : -1
      const mirrored = side === "left" ? direction : -direction
      const step = event.shiftKey
        ? WORKSPACE_DRAWER.resizeKeyboardLargeStep
        : WORKSPACE_DRAWER.resizeKeyboardStep
      commitKeyboardWidth(
        clampArtifactDrawerWidth(width + mirrored * step, window.innerWidth)
      )
    },
    [commitKeyboardWidth, resetWidth, side, width]
  )
  const onResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
        currentWidth: width,
      }
      document.body.classList.add("drawer-resizing")
    },
    [width]
  )
  const onResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const delta = event.clientX - drag.startX
      const next = clampArtifactDrawerWidth(
        drag.startWidth + (side === "left" ? delta : -delta),
        window.innerWidth
      )
      drag.currentWidth = next
      setWidth(next)
    },
    [side]
  )
  const finishResize = useCallback(
    (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      const next = dragRef.current.currentWidth
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)
      dragRef.current = null
      document.body.classList.remove("drawer-resizing")
      if (commit) commitWidth(next)
    },
    [commitWidth]
  )

  const viewportWidth =
    typeof window === "undefined"
      ? WORKSPACE_DRAWER.narrowBreakpoint
      : window.innerWidth
  const boundedWidth = clampArtifactDrawerWidth(width, viewportWidth)
  const renderedWidth = narrow
    ? `${WORKSPACE_DRAWER.narrowViewportRatio * 100}vw`
    : `${boundedWidth}px`
  const style = {
    zIndex,
    "--layered-drawer-width": renderedWidth,
  } as CSSProperties

  return (
    <Drawer.Root
      open={open}
      modal={false}
      disablePointerDismissal
      swipeDirection={side === "left" ? "left" : "right"}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return
        if (details.reason === "escape-key") {
          details.cancel()
          details.allowPropagation()
          return
        }
        if (details.reason === "outside-press") {
          details.cancel()
          return
        }
        onClose()
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) queueMicrotask(restoreFocus)
        onOpenChangeComplete?.(nextOpen)
      }}
    >
      <Drawer.Portal
        className="tc layered-drawer-portal"
        container={container}
        keepMounted
      >
        <Drawer.Viewport className="layered-drawer-viewport" style={{ zIndex }}>
          <Drawer.Popup
            className={`layered-drawer ${side} ${narrow ? "narrow" : ""} ${className}`}
            ref={popupRef}
            style={style}
            data-layered-drawer-top={topLayer ? "true" : "false"}
            aria-hidden={!open || !topLayer}
            inert={!open || !topLayer}
            initialFocus={false}
            finalFocus={false}
            onPointerDown={onActivate}
          >
            {resizable && !narrow && (
              <div
                className="layered-drawer-resizer"
                role="separator"
                aria-label="调整抽屉宽度"
                aria-orientation="vertical"
                aria-valuemin={WORKSPACE_DRAWER.artifactMinWidth}
                aria-valuemax={Math.floor(
                  viewportWidth * WORKSPACE_DRAWER.artifactMaxViewportRatio
                )}
                aria-valuenow={Math.round(boundedWidth)}
                tabIndex={0}
                onKeyDown={onResizeKeyDown}
                onDoubleClick={resetWidth}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={(event) => finishResize(event, true)}
                onPointerCancel={(event) => finishResize(event, false)}
              />
            )}
            <Drawer.Content className="layered-drawer-content">
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
