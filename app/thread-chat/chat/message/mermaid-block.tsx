"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { MermaidCanvas } from "./mermaid-canvas"
import type { MarkdownSettlementBatch } from "@/lib/markdown/settlement-batch"

/** SVG 通过图片隔离展示，避免图内样式、脚本和重复 id 进入正文 DOM。 */
export function MermaidBlock({ code, streaming, batch, children }: {
  code: string
  streaming: boolean
  batch?: MarkdownSettlementBatch
  children: ReactNode
}) {
  const { resolvedTheme } = useTheme()
  const rootRef = useRef<HTMLDivElement>(null)
  const registrationRef = useRef<ReturnType<MarkdownSettlementBatch["register"]> | null>(null)
  const [view, setView] = useState<"diagram" | "code">("diagram")
  const [result, setResult] = useState<{ code: string; theme?: string; url: string | null } | null>(null)
  const current = !streaming && result?.code === code && result.theme === resolvedTheme ? result : null
  const failed = current !== null && current.url === null
  const showCode = view === "code" || failed

  useLayoutEffect(() => {
    const registration = batch?.register() ?? null
    registrationRef.current = registration
    return () => {
      registration?.cancel()
      if (registrationRef.current === registration) registrationRef.current = null
    }
  }, [batch])

  useEffect(() => {
    if (streaming || !rootRef.current) return
    let active = true
    const styles = getComputedStyle(rootRef.current)
    // 在宿主解析语义色：独立 SVG 图片无法继承外部 CSS 变量。
    const bg = styles.getPropertyValue("--tc-surface-base").trim()
    const fg = styles.getPropertyValue("--tc-content-primary").trim()
    import("beautiful-mermaid").then(({ renderMermaidSVG }) => {
      if (!active) return
      const svg = renderMermaidSVG(code, { bg, fg, transparent: true, font: "system-ui" })
      setResult({ code, theme: resolvedTheme, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })
    }).catch(() => {
      if (active) setResult({ code, theme: resolvedTheme, url: null })
    })
    return () => { active = false }
  }, [code, resolvedTheme, streaming])

  useEffect(() => {
    if (failed) {
      registrationRef.current?.settle()
    }
  }, [failed, batch])

  return (
    <div className="md-mermaid" ref={rootRef}>
      <div className="md-mermaid-tools" role="group" aria-label="Mermaid 显示方式">
        <button type="button" aria-pressed={!showCode} disabled={failed} onClick={() => setView("diagram")}>图表</button>
        <button type="button" aria-pressed={showCode} onClick={() => setView("code")}>源码</button>
      </div>
      {current?.url ? (
        <MermaidCanvas key={code} url={current.url} hidden={showCode}
          onLoad={() => registrationRef.current?.settle()}
          onError={() => setResult({ code, theme: resolvedTheme, url: null })} />
      ) : <div hidden={showCode} className="md-mermaid-status">{streaming ? "图表生成中…" : "正在绘制图表…"}</div>}
      {/* 保留源码 DOM，避免切换视图反复挂载高亮体。 */}
      <div hidden={!showCode}>{children}</div>
      {failed && <div className="md-mermaid-status">暂时无法绘制此图，已显示源码。</div>}
    </div>
  )
}
