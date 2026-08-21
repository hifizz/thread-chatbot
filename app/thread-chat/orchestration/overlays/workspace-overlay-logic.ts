export type EscapeOverlayTarget =
  "help" | "tree-list" | "selection" | "switcher" | "drawer" | null

export function escapeOverlayTarget(state: {
  helpOpen: boolean
  treeListOpen: boolean
  selectionOpen: boolean
  switcherOpen: boolean
  drawerOpen: boolean
}): EscapeOverlayTarget {
  if (state.helpOpen) return "help"
  if (state.treeListOpen) return "tree-list"
  if (state.selectionOpen) return "selection"
  if (state.switcherOpen) return "switcher"
  if (state.drawerOpen) return "drawer"
  return null
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
