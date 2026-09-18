"use client"

import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react"
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react"
import { MERMAID_CANVAS as C } from "@/constants/mermaid"
import { automaticDiagramScale, constrainDiagram, fitDiagram, zoomDiagram, type DiagramSize, type DiagramTransform } from "@/lib/markdown/mermaid-viewport"
import { useI18n } from "@/lib/i18n/client"


type Point = { x: number; y: number }

/** 仅处理图片视口；SVG 生成、流式状态和失败回退仍由 MermaidBlock 管理。 */
export function MermaidCanvas({ url, hidden, viewControls, onLoad, onError }: {
  url: string
  hidden: boolean
  viewControls: ReactNode
  onLoad: () => void
  onError: () => void
}) {
  const { t } = useI18n()

  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [state, setState] = useState<{
    image: DiagramSize; canvas: DiagramSize; transform: DiagramTransform
  } | null>(null)
  const manual = useRef(false)
  const pointers = useRef(new Map<number, Point>())

  useEffect(() => {
    // 切换 Markdown 结算批次时图片可能已缓存，不会再次触发 load。
    const image = imageRef.current
    if (image?.complete && image.naturalWidth > 0 && (state || !viewportRef.current?.clientWidth)) onLoad()
  }, [state, onLoad])

  useEffect(() => {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return
    const measure = () => {
      if (!image.naturalWidth || !viewport.clientWidth) return
      const size = { width: image.naturalWidth, height: image.naturalHeight }
      const width = viewport.clientWidth
      const maxHeight = Math.max(C.minHeight, Math.min(C.maxHeight, window.innerHeight * C.viewportHeightRatio))
      const initialScale = automaticDiagramScale(size, { width, height: maxHeight })
      const canvas = { width, height: Math.min(maxHeight, Math.max(C.minHeight, size.height * initialScale + C.padding * 2)) }
      setState((previous) => {
        const transform = manual.current && previous
          ? previous.transform
          : { scale: automaticDiagramScale(size, canvas), x: C.padding, y: C.padding }
        return { image: size, canvas, transform: constrainDiagram(transform, size, canvas) }
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    image.addEventListener("load", measure)
    window.addEventListener("resize", measure)
    measure()
    return () => {
      observer.disconnect()
      image.removeEventListener("load", measure)
      window.removeEventListener("resize", measure)
    }
  }, [url])

  const zoom = (scale: number | ((current: number) => number), anchor?: Point) => {
    manual.current = true
    setState((previous) => {
      if (!previous) return previous
      const { image, canvas, transform } = previous
      const minimum = Math.min(C.minScale, fitDiagram(image, canvas))
      const target = typeof scale === "function" ? scale(transform.scale) : scale
      const next = zoomDiagram(transform, Math.max(minimum, Math.min(C.maxScale, target)), anchor ?? { x: canvas.width / 2, y: canvas.height / 2 })
      return { ...previous, transform: constrainDiagram(next, image, canvas) }
    })
  }

  const reset = () => {
    manual.current = false
    setState((previous) => previous && ({ ...previous, transform: constrainDiagram({
      scale: automaticDiagramScale(previous.image, previous.canvas), x: C.padding, y: C.padding,
    }, previous.image, previous.canvas) }))
  }

  const pan = (dx: number, dy: number) => {
    manual.current = true
    setState((previous) => previous && ({ ...previous, transform: constrainDiagram({
      ...previous.transform, x: previous.transform.x + dx, y: previous.transform.y + dy,
    }, previous.image, previous.canvas) }))
  }

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous || !state) return
    const next = { x: event.clientX, y: event.clientY }
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
    pointers.current.set(event.pointerId, next)
    if (!other) {
      pan(next.x - previous.x, next.y - previous.y)
      return
    }
    const before = Math.hypot(previous.x - other.x, previous.y - other.y)
    const after = Math.hypot(next.x - other.x, next.y - other.y)
    if (before === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    // 以双指中点缩放，同时允许双指一起平移。
    zoom((current) => current * after / before, {
      x: (previous.x + other.x) / 2 - rect.left,
      y: (previous.y + other.y) / 2 - rect.top,
    })
    pan((next.x - previous.x) / 2, (next.y - previous.y) / 2)
  }

  const scale = state?.transform.scale ?? 1
  return (
    <div className="md-mermaid-canvas">
      <div className="md-mermaid-toolbar">
        {viewControls}
        <div hidden={hidden} className="md-mermaid-tools" role="group" aria-label={t("ui.diagramZoom")}>
          <button type="button" aria-label={t("ui.zoomOutOfDiagram")} title={t("ui.zoomOut")} disabled={!state || scale <= Math.min(C.minScale, fitDiagram(state.image, state.canvas))} onClick={() => zoom(scale / C.zoomStep)}><Minus size={16} /></button>
          <button type="button" className="md-mermaid-scale" aria-label={t("chat.zoomPercent", { percent: Math.round(scale * 100) })} title={t("ui.restore100")} disabled={!state} onClick={() => zoom(1)}>{Math.round(scale * 100)}%</button>
          <button type="button" aria-label={t("ui.zoomIntoDiagram")} title={t("ui.zoomIn")} disabled={!state || scale >= C.maxScale} onClick={() => zoom(scale * C.zoomStep)}><Plus size={16} /></button>
          <button type="button" aria-label={t("ui.fitToCanvas")} title={t("ui.fitToCanvas")} disabled={!state} onClick={() => { if (state) zoom(fitDiagram(state.image, state.canvas)) }}><Maximize size={16} /></button>
          <button type="button" aria-label={t("ui.resetDiagram")} title={t("ui.resetToAutomaticFit")} disabled={!state} onClick={reset}><RotateCcw size={16} /></button>
        </div>
      </div>
      <div hidden={hidden} ref={viewportRef} className="md-mermaid-viewport" role="region" aria-label={t("ui.mermaidDiagramDragOrUseThe")} tabIndex={hidden ? -1 : 0}
        style={{ height: state?.canvas.height ?? C.minHeight }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          const delta: Record<string, Point> = {
            ArrowLeft: { x: C.keyboardPan, y: 0 }, ArrowRight: { x: -C.keyboardPan, y: 0 },
            ArrowUp: { x: 0, y: C.keyboardPan }, ArrowDown: { x: 0, y: -C.keyboardPan },
          }
          if (delta[event.key]) { event.preventDefault(); pan(delta[event.key].x, delta[event.key].y) }
          if (event.key === "+" || event.key === "=" || event.key === "-") {
            event.preventDefault(); zoom(scale * (event.key === "-" ? 1 / C.zoomStep : C.zoomStep))
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || pointers.current.size >= 2) return
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.focus({ preventScroll: true })
        }}
        onPointerMove={movePointer}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG 图片隔离，保留原始尺寸供画布计算。 */}
        <img ref={imageRef} src={url} alt={t("ui.mermaidDiagramSourceViewAvailable")} draggable={false} onLoad={() => {
          // 可见图表等待尺寸提交后再结算，避免聊天自动滚动采用占位高度。
          if (!viewportRef.current?.clientWidth) onLoad()
        }} onError={onError}
          style={{ width: state?.image.width, height: state?.image.height, visibility: state ? "visible" : "hidden",
            transform: state ? `translate(${state.transform.x}px, ${state.transform.y}px) scale(${scale})` : undefined }} />
      </div>
    </div>
  )
}
