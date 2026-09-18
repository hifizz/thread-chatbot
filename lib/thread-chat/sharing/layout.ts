import type { PublicLayout } from "./contracts"

/**
 * 布局白名单规范化：所有实体引用必须落在快照内；失效引用降级为安全默认值
 * （布局不是内容，可降级不拒绝）。
 */
export function normalizeShareLayout(
  layout: PublicLayout,
  scope: { threadIds: ReadonlySet<string>; artifactIds: ReadonlySet<string> }
): PublicLayout {
  const columnSlots = layout.columnSlots.filter((slot) =>
    scope.threadIds.has(slot.threadId)
  )
  const slotIds = new Set(columnSlots.map((slot) => slot.threadId))
  return {
    view: layout.view,
    columnSlots,
    columnWidths: Object.fromEntries(
      Object.entries(layout.columnWidths).filter(([threadId]) =>
        scope.threadIds.has(threadId)
      )
    ),
    forceColumns: layout.forceColumns,
    placementMode: layout.placementMode,
    selectedThreadId:
      layout.selectedThreadId && scope.threadIds.has(layout.selectedThreadId)
        ? layout.selectedThreadId
        : slotIds.size > 0
          ? [...slotIds][slotIds.size - 1]
          : null,
    canvas: {
      pins: Object.fromEntries(
        Object.entries(layout.canvas.pins).filter(([threadId]) =>
          scope.threadIds.has(threadId)
        )
      ),
      ...(layout.canvas.viewport ? { viewport: layout.canvas.viewport } : {}),
    },
    panelSizes: layout.panelSizes,
    expandedNodes: layout.expandedNodes,
    activeArtifactId:
      layout.activeArtifactId && scope.artifactIds.has(layout.activeArtifactId)
        ? layout.activeArtifactId
        : null,
    drawerOpen: layout.drawerOpen && layout.activeArtifactId !== null
      ? scope.artifactIds.has(layout.activeArtifactId)
      : false,
  }
}
