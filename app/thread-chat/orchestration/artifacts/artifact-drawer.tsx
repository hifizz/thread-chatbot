"use client"
/**
 * orchestration/artifact-drawer —— Artifact 右侧抽屉「舞台」（全局唯一）。
 * 标签页管理全部 artifact（深度色圆点标来源会话），Markdown 走统一富文本渲染，
 * 底部「定位来源会话」走壳层的统一打开意图。
 */

import React, { useEffect, useId, useRef } from "react"
import { FileText, LocateFixed, X } from "lucide-react"
import type { Artifact, ThreadTreeState } from "../../core/types"
import { MarkdownBody } from "../../chat/message/markdown-body"
import { dotColorOf } from "../../theme"
import {
  activePathArtifacts,
  artifactSourceProvenance,
} from "../../core/selectors"

export interface ArtifactDrawerProps {
  state: ThreadTreeState
  open: boolean
  /** 当前激活的 artifact id（null 时回退到第一个） */
  activeId: string | null
  onClose: () => void
  onSelect: (id: string) => void
  /** 定位来源会话（壳层用 openBranchUI 打开） */
  onLocate: (threadId: string, sourceMessageId: string) => void
  loadState?:
    | { status: "idle" | "loading" | "ready" }
    | { status: "error"; message: string; onRetry: () => void }
}

export function ArtifactDrawer({
  state,
  open,
  activeId,
  onClose,
  onSelect,
  onLocate,
  loadState,
}: ArtifactDrawerProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
      }
      wasOpenRef.current = true
      const frame = requestAnimationFrame(() => closeButtonRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [open])

  const activeArtifacts = activePathArtifacts(state)
  const visibleArtifacts = activeId
    ? [
        ...activeArtifacts,
        ...(!activeArtifacts.some((artifact) => artifact.id === activeId) &&
        state.artifacts[activeId]
          ? [state.artifacts[activeId]]
          : []),
      ]
    : activeArtifacts
  const a: Artifact | null =
    (activeId && state.artifacts[activeId]) || visibleArtifacts[0] || null
  const src = a ? state.threads[a.sourceThreadId] : null
  const provenance = a ? artifactSourceProvenance(state, a) : null

  return (
    <div
      className={`art-drawer ${open ? "open" : ""}`}
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="art-head">
        <FileText size={16} color="#6a6357" />
        <h3 id={titleId}>Markdown</h3>
        <button
          ref={closeButtonRef}
          type="button"
          className="art-x"
          title="收起抽屉"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>
      {visibleArtifacts.length > 0 && (
        <div className="art-tabs">
          {visibleArtifacts.map((art) => {
            const aid = art.id
            const sb = state.threads[art.sourceThreadId]
            return (
              <button
                key={aid}
                className={`art-tab ${a?.id === aid ? "on" : ""}`}
                style={
                  {
                    "--dc": sb ? dotColorOf(sb) : "#8a8377",
                  } as React.CSSProperties
                }
                title={`来自「${sb?.title ?? "?"}」`}
                onClick={() => onSelect(aid)}
              >
                <span className="dot" />
                {art.title}
                {!artifactSourceProvenance(state, art).isOnActivePath && (
                  <span className="historical-artifact">历史版本</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      <div className="art-body">
        {a && loadState?.status === "loading" && (
          <div className="art-empty">Markdown 加载中…</div>
        )}
        {a && loadState?.status === "error" && (
          <button className="art-empty" type="button" onClick={loadState.onRetry}>
            加载失败：{loadState.message} · 点击重试
          </button>
        )}
        {!a && (
          <div className="art-empty">
            还没有 Markdown——在主线或分支里生成后会出现在这里。
          </div>
        )}
        {a && loadState?.status !== "loading" && loadState?.status !== "error" && a.kind === "code" && <pre className="art-code">{a.content}</pre>}
        {a && loadState?.status !== "loading" && loadState?.status !== "error" && a.kind === "note" && (
          <div className="art-note">
            {a.content.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        {a && loadState?.status !== "loading" && loadState?.status !== "error" && a.kind === "markdown" && (
          <div className="mx-auto my-6 max-w-2xl">
            <MarkdownBody source={a.content} />
          </div>
        )}
      </div>
      {a && src && (
        <div
          className="art-src"
          style={{ "--dc": dotColorOf(src) } as React.CSSProperties}
        >
          <span className="dot" />
          <span className="nm">
            来源会话：{src.title}
            {src.footnote !== null ? ` · 脚注 ${src.footnote}` : ""}
            {provenance && !provenance.isOnActivePath
              ? ` · 来自回复 ${
                  provenance.alternativeIndex === null
                    ? "?"
                    : provenance.alternativeIndex + 1
                }/${provenance.alternativeCount} · 历史版本`
              : ""}
          </span>
          <button
            className="loc"
            title="打开产生这个 Markdown 的会话"
            onClick={() => onLocate(src.id, a.sourceMessageId)}
          >
            <LocateFixed size={10} />
            定位来源会话
          </button>
        </div>
      )}
    </div>
  )
}
