import { ARTIFACT_REFERENCE_MENU_LAYOUT } from "@/constants/artifact-reference"

type Viewport = { left: number; top: number; width: number; height: number }
type Anchor = { left: number; top: number; bottom: number }

/** 按可视区域选择方向，而不是按只有一行高的编辑器判断翻转。 */
export function positionArtifactMenu(anchor: Anchor, viewport: Viewport, contentHeight: number) {
  const { padding, gap, width: preferredWidth, maxHeight: preferredHeight } = ARTIFACT_REFERENCE_MENU_LAYOUT
  const leftEdge = viewport.left + padding
  const topEdge = viewport.top + padding
  const rightEdge = viewport.left + viewport.width - padding
  const bottomEdge = viewport.top + viewport.height - padding
  const width = Math.max(0, Math.min(preferredWidth, rightEdge - leftEdge))
  const above = Math.max(0, anchor.top - gap - topEdge)
  const below = Math.max(0, bottomEdge - anchor.bottom - gap)
  const wantedHeight = Math.min(contentHeight, preferredHeight)
  const side = below < wantedHeight && above > below ? "top" : "bottom"
  const maxHeight = Math.max(0, Math.min(preferredHeight, side === "top" ? above : below, bottomEdge - topEdge))
  const height = Math.min(contentHeight, maxHeight)
  return {
    side, width, maxHeight,
    left: Math.max(leftEdge, Math.min(anchor.left, rightEdge - width)),
    top: Math.max(topEdge, Math.min(side === "top" ? anchor.top - gap - height : anchor.bottom + gap, bottomEdge - height)),
  }
}
