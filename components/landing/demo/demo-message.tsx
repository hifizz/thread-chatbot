"use client"

/**
 * demo/demo-message —— 演示里的单条消息。
 * 复刻 .tc 的 .message/.who/.bubble/.anchored/.fnote/.acard 结构；
 * 锚点是 span[role=button]；划选气泡在 demo-frame 的 .ld 根级渲染。
 */

import type { ReactElement } from "react"

import {
  branchOfAnchor,
  type DemoMessage,
  type DemoScenario,
  type InlineNode,
} from "@/constants/landing-demo"

import type { DemoView } from "./use-demo-player"

interface Props {
  scenario: DemoScenario
  columnId: string
  message: DemoMessage
  /** 正在打字揭示：可见字符数；undefined 表示完整显示 */
  visibleChars?: number
  /** 播放器当前的揭示进度（划选逐字高亮 / 气泡打字也用它） */
  progressChars: number
  view: DemoView
  onAnchor: (anchorId: string) => void
}

/** 按可见字符数截断整条消息的段落（纯函数，模块级）。 */
function truncateBlocks(
  blocks: InlineNode[][],
  max: number,
): InlineNode[][] {
  const out: InlineNode[][] = []
  let left = max
  for (const nodes of blocks) {
    if (left <= 0) break
    const part: InlineNode[] = []
    for (const node of nodes) {
      if (left <= 0) break
      if (node.text.length <= left) {
        part.push(node)
        left -= node.text.length
      } else {
        part.push({ ...node, text: node.text.slice(0, left) })
        left = 0
      }
    }
    if (part.length > 0) out.push(part)
  }
  return out
}

function Inline({
  scenario,
  nodes,
  view,
  progressChars,
  onAnchor,
}: {
  scenario: DemoScenario
  nodes: InlineNode[]
  view: DemoView
  progressChars: number
  onAnchor: (id: string) => void
}): ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === "strong") return <strong key={i}>{node.text}</strong>
        if (node.kind === "anchor") {
          const branch = branchOfAnchor(scenario, node.anchorId)
          const fc = ((branch?.depth ?? 1) - 1) % 5 + 1 || 1
          const fnote = view.footnotes[node.anchorId]
          const selected = view.selectedAnchors.has(node.anchorId)
          const selecting = view.selectingAnchor === node.anchorId
          const selChars =
            selecting && view.selectRevealing
              ? Math.min(progressChars, node.text.length)
              : node.text.length
          const interactive = selected && !selecting
          return (
            <span
              key={i}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              className={`anchored fc-${fc}${selected ? " selected" : ""}${selecting && !selected ? " selecting" : ""}`}
              data-cursor-target={`anchor-${node.anchorId}`}
              onClick={
                interactive
                  ? () => {
                      /* 拖选经过锚点时也忽略 click，交给文本划选流程 */
                      if (window.getSelection()?.isCollapsed === false) return
                      onAnchor(node.anchorId)
                    }
                  : undefined
              }
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onAnchor(node.anchorId)
                      }
                    }
                  : undefined
              }
              aria-label={
                interactive ? `打开「${node.text}」的分支` : undefined
              }
            >
              {selecting && !selected ? (
                <>
                  <span className="sel">
                    {node.text.slice(0, selChars)}
                    <i
                      className="sel-tail"
                      data-cursor-target="selend"
                      aria-hidden
                    />
                  </span>
                  {node.text.slice(selChars)}
                </>
              ) : (
                node.text
              )}
              {fnote !== undefined && <sup className="fnote">{fnote}</sup>}
            </span>
          )
        }
        return <span key={i}>{node.text}</span>
      })}
    </>
  )
}

export function DemoMessageView({
  scenario,
  message,
  visibleChars,
  progressChars,
  view,
  onAnchor,
}: Props): ReactElement {
  const revealing = visibleChars !== undefined
  const blocks = truncateBlocks(
    message.blocks,
    visibleChars ?? Number.POSITIVE_INFINITY,
  )

  const artifactDone =
    !revealing && message.artifact && view.shown.has(message.id)

  return (
    <div className={`message ${message.role}`}>
      <div className="who">{message.role === "user" ? "你" : "AI"}</div>
      <div className={`bubble${revealing ? " streaming" : ""}`}>
        {message.quote && <div className="msg-quote">{message.quote}</div>}
        {(view.sentCapsule && message.capsules
          ? [view.sentCapsule]
          : (message.capsules ?? [])
        ).map((c) => (
          <span key={c.id} className="composer-capsule" title={c.title}>
            {c.title}
          </span>
        ))}
        {blocks.map((nodes, i) => (
          <p key={i}>
            <Inline
              scenario={scenario}
              nodes={nodes}
              view={view}
              progressChars={progressChars}
              onAnchor={onAnchor}
            />
          </p>
        ))}
        {revealing && <span className="caret" aria-hidden />}
      </div>
      {artifactDone && message.artifact && (
        <div className="acard acard-static" role="img" aria-label={`Artifact：${message.artifact.title}`}>
          <span className="thumb">
            <span className="thumb-back" />
            <span className="thumb-front">
              <span className="thumb-lines">
                <i />
                <i />
                <i />
              </span>
            </span>
          </span>
          <span className="t">
            <span className="n">{message.artifact.title}</span>
            <span className="k">{message.artifact.kind}</span>
          </span>
        </div>
      )}
    </div>
  )
}
