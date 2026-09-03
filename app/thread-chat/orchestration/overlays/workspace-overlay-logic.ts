import { WORKSPACE_DRAWER } from "@/constants/workspace-drawers"

export type DrawerId = "project" | "artifacts"
export type DrawerSide = "left" | "right"
export type TransientOverlayId = "help" | "tree-list" | "switcher" | "selection"
export type EscapeOverlayTarget =
  | { kind: "internal" }
  | { kind: "transient"; id: TransientOverlayId }
  | { kind: "drawer"; id: DrawerId }
  | null

export function openLayer(stack: DrawerId[], id: DrawerId): DrawerId[] {
  return [...stack.filter((item) => item !== id), id]
}

export function closeLayer(stack: DrawerId[], id: DrawerId): DrawerId[] {
  return stack.filter((item) => item !== id)
}

export function topLayer(stack: DrawerId[]): DrawerId | null {
  return stack.at(-1) ?? null
}

export function layerZIndex(index: number): number {
  return WORKSPACE_DRAWER.baseZIndex + index * WORKSPACE_DRAWER.zIndexStep
}

export function escapeOverlayTarget(state: {
  internalOpen?: boolean
  transientStack: TransientOverlayId[]
  drawerStack: DrawerId[]
  isComposing?: boolean
  repeat?: boolean
}): EscapeOverlayTarget {
  if (state.isComposing || state.repeat) return null
  if (state.internalOpen) return { kind: "internal" }
  const transient = state.transientStack.at(-1)
  if (transient) return { kind: "transient", id: transient }
  const drawer = topLayer(state.drawerStack)
  return drawer ? { kind: "drawer", id: drawer } : null
}

export function isNarrowDrawerViewport(viewportWidth: number): boolean {
  return viewportWidth < WORKSPACE_DRAWER.narrowBreakpoint
}

export function drawerWidthBounds(viewportWidth: number) {
  return {
    min: Math.min(WORKSPACE_DRAWER.artifactMinWidth, viewportWidth),
    max: Math.max(
      Math.min(WORKSPACE_DRAWER.artifactMinWidth, viewportWidth),
      Math.floor(viewportWidth * WORKSPACE_DRAWER.artifactMaxViewportRatio)
    ),
  }
}

export function clampArtifactDrawerWidth(
  width: number,
  viewportWidth: number
): number {
  const { min, max } = drawerWidthBounds(viewportWidth)
  return Math.min(max, Math.max(min, width))
}

export function drawerSideForAnchor({
  anchorLeft,
  anchorRight,
  viewportWidth,
  drawerWidth,
}: {
  anchorLeft: number
  anchorRight: number
  viewportWidth: number
  drawerWidth: number
}): DrawerSide {
  const preferred: DrawerSide =
    (anchorLeft + anchorRight) / 2 < viewportWidth / 2 ? "right" : "left"
  const overlaps =
    preferred === "right"
      ? anchorRight > viewportWidth - drawerWidth
      : anchorLeft < drawerWidth
  return overlaps ? (preferred === "right" ? "left" : "right") : preferred
}

export function popupPosition({
  right,
  bottom,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
}: {
  right: number
  bottom: number
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
}) {
  const x = Math.max(
    8,
    Math.min(right - panelWidth, viewportWidth - (panelWidth + 8))
  )
  let y = bottom + 6
  if (y + panelHeight > viewportHeight)
    y = Math.max(8, viewportHeight - (panelHeight + 10))
  return { x, y }
}
