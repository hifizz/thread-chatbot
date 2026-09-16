"use client"

/**
 * demo/demo-column —— 演示分栏：列头（面包屑/标题/深度徽标）+ 消息流 + 仿制输入框。
 * DOM 结构与 .tc .column 对齐；主线列的 composer 承载打字、胶囊与 @ 弹层。
 */

import { ArrowUp, Plus } from "lucide-react"
import { useEffect, useRef, type ReactElement, type RefObject } from "react"

import {
  findAnchor,
  type DemoColumn,
  type DemoScenario,
} from "@/constants/landing-demo"

import { ArtifactPicker } from "./artifact-picker"
import { DemoMessageView } from "./demo-message"
import type { DemoView } from "./use-demo-player"

interface Props {
  scenario: DemoScenario
  column: DemoColumn
  view: DemoView
  revealChars: number
  onAnchor: (anchorId: string) => void
  onPick: Parameters<typeof ArtifactPicker>[0]["onPick"]
  onClosePicker: () => void
  composerRef?: RefObject<HTMLDivElement | null>
}

export function DemoColumnView({
  scenario,
  column,
  view,
  revealChars,
  onAnchor,
  onPick,
  onClosePicker,
  composerRef,
}: Props): ReactElement {
  const isMain = column.depth === 0
  const listRef = useRef<HTMLDivElement>(null)
  const signature = `${view.shown.size}:${view.revealing ?? ""}:${view.revealing ? revealChars : 0}:${view.composerText}:${view.capsule?.id ?? ""}`
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [signature])
  const fc = ((column.depth || 1) - 1) % 5 + 1
  const source = column.sourceAnchor
    ? findAnchor(scenario, column.sourceAnchor)
    : undefined
  const fnote = column.sourceAnchor
    ? view.footnotes[column.sourceAnchor]
    : undefined

  return (
    <section
      className={`column${isMain ? "" : " branch"} fc-${fc}`}
      style={{ ["--tc-accent" as string]: `var(--tc-depth-${fc})` }}
      aria-label={column.title}
      data-column={column.id}
    >
      <header className="col-head">
        <div className="crumb">
          {column.crumb.map((seg, i) => {
            const last = i === column.crumb.length - 1
            return (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <span className="chev">›</span>}
                <span className={last ? "here" : "seg2"}>{seg}</span>
              </span>
            )
          })}
        </div>
        <div className="ctitle-row">
          {!isMain && <span className="depth-badge">D{column.depth}</span>}
          <span className="ctitle">{column.title}</span>
          <span className="cbtn tree" aria-hidden>
            <span className="n">{column.crumb.length > 1 ? "⌘" : "⌘1"}</span>
          </span>
        </div>
        <div className="col-sub">{column.sub}</div>
      </header>

      <div className="msg-list" ref={listRef}>
        <div className="lane">
          {source && (
            <div className="branch-context">
              <div className="focus-banner">
                <span className="fn">{fnote ?? "·"}</span>
                <span className="ft">
                  <span className="lbl">来自{isMain ? "主线" : column.crumb[column.crumb.length - 2] ?? "主线"}</span>
                  <q>{source.text}</q>
                </span>
              </div>
              {column.inheritedCount !== undefined && (
                <details className="inherited">
                  <summary>
                    <span className="tw">▸</span>继承的上文 · {column.inheritedCount} 条
                  </summary>
                </details>
              )}
            </div>
          )}
          {isMain && (
            <div className="hint">
              <ul>
                <li>划选回答里的任意文字，就能在旁边开一条分支</li>
                <li>分支不会打扰主线，结论可以用 @ 带回来</li>
              </ul>
            </div>
          )}
          {column.messages.map((m) => {
            const revealing = view.revealing === m.id
            if (!revealing && !view.shown.has(m.id)) return null
            return (
              <DemoMessageView
                key={m.id}
                scenario={scenario}
                columnId={column.id}
                message={m}
                visibleChars={revealing ? revealChars : undefined}
                view={view}
                onAnchor={onAnchor}
              />
            )
          })}
        </div>
      </div>

      <footer className={`composer${isMain ? "" : " branch"}`}>
        <div className="box" ref={isMain ? composerRef : undefined}>
          {isMain ? (
            <>
              <div
                className="editor"
                data-cursor-target="composer"
                tabIndex={-1}
              >
                {view.capsule && (
                  <span className="composer-capsule">{view.capsule.title}</span>
                )}
                {view.composerText
                  ? view.composerTyping
                    ? view.composerText.slice(0, revealChars)
                    : view.composerText
                  : null}
                {!view.composerText && !view.capsule && (
                  <span className="placeholder">输入问题，@ 引用 Artifact</span>
                )}
                {view.composerTyping && <span className="caret" aria-hidden />}
              </div>
              {view.pickerOpen && scenario.pickerItems && (
                <ArtifactPicker
                  items={scenario.pickerItems}
                  onPick={onPick}
                  onClose={onClosePicker}
                />
              )}
            </>
          ) : (
            <div className="editor">
              <span className="placeholder">继续追问…</span>
            </div>
          )}
          <div className="tools">
            <span className="tool-icon" aria-hidden>
              <Plus size={13} />
            </span>
            <span className="tool-model">GPT-5.6 Luna</span>
            <span className="spacer" />
            <span
              className="send"
              data-cursor-target={isMain ? "send" : undefined}
              aria-hidden
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </footer>
    </section>
  )
}
