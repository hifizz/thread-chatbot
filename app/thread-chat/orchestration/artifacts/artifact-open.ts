import type { DrawerSide } from "../overlays/workspace-overlay-logic"

/** 可跨客户端组件边界传递的卡片位置，不携带 DOMRect 方法。 */
export interface ArtifactAnchorRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export interface OpenArtifactOptions {
  source: "pointer" | "keyboard" | "topbar"
  anchorRect?: ArtifactAnchorRect
}

export type OpenArtifact = (
  artifactId: string,
  options: OpenArtifactOptions
) => void

export function serializeArtifactAnchorRect(
  rect: DOMRect
): ArtifactAnchorRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export const TOPBAR_ARTIFACT_OPEN: OpenArtifactOptions = { source: "topbar" }
export const KEYBOARD_ARTIFACT_OPEN: OpenArtifactOptions = {
  source: "keyboard",
}

export interface ArtifactDrawerPlacement {
  side: DrawerSide
  width: number
}
