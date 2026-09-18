import type { ConversationStore } from "../../core/store"
import type { PublicLayout } from "@/lib/thread-chat/sharing/contracts"

/**
 * 确认创建分享的那一刻从 store 现取布局：只挑公开布局白名单字段，
 * recents/草稿/模型设置天然不带。Artifact 抽屉初值由 overlay 层传入。
 */
export function captureShareLayout(
  store: ConversationStore,
  overlay: { drawerOpen: boolean; activeArtifactId: string | null }
): PublicLayout {
  const workspace = store.getState().workspace
  return {
    view: workspace.view,
    columnSlots: workspace.columnSlots,
    columnWidths: workspace.columnWidths,
    forceColumns: workspace.forceColumns,
    placementMode: workspace.placementMode,
    selectedThreadId: workspace.selectedThreadId || null,
    canvas: workspace.canvas,
    panelSizes: workspace.panelSizes,
    expandedNodes: workspace.expandedNodes,
    activeArtifactId: overlay.activeArtifactId,
    drawerOpen: overlay.drawerOpen,
  }
}
