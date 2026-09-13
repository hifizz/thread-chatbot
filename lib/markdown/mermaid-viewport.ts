import { MERMAID_CANVAS as C } from "@/constants/mermaid"

export type DiagramSize = { width: number; height: number }
export type DiagramTransform = { scale: number; x: number; y: number }

export function fitDiagram(image: DiagramSize, canvas: DiagramSize) {
  return Math.min(1, Math.max(1, canvas.width - C.padding * 2) / image.width,
    Math.max(1, canvas.height - C.padding * 2) / image.height)
}

export function automaticDiagramScale(image: DiagramSize, canvas: DiagramSize) {
  return Math.max(C.autoMinScale, fitDiagram(image, canvas))
}

/** 小图居中，大图限制拖动边界，避免整张图被拖出画布。 */
export function constrainDiagram(transform: DiagramTransform, image: DiagramSize, canvas: DiagramSize): DiagramTransform {
  const axis = (position: number, content: number, available: number) =>
    content + C.padding * 2 <= available
      ? (available - content) / 2
      : Math.min(C.padding, Math.max(available - content - C.padding, position))
  return {
    scale: transform.scale,
    x: axis(transform.x, image.width * transform.scale, canvas.width),
    y: axis(transform.y, image.height * transform.scale, canvas.height),
  }
}

export function zoomDiagram(transform: DiagramTransform, scale: number, anchor: { x: number; y: number }) {
  const ratio = scale / transform.scale
  return { scale, x: anchor.x - (anchor.x - transform.x) * ratio, y: anchor.y - (anchor.y - transform.y) * ratio }
}
