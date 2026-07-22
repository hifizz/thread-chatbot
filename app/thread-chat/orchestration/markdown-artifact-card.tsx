"use client"

import { FileCode2, FileText, LoaderCircle } from "lucide-react"
import type { Artifact, MarkdownGenerationProgress } from "../core/types"
import { dc } from "../theme"

export interface MarkdownArtifactCardProps {
  artifact: Artifact
  sourceDepth: number | null
  onOpen: (artifactId: string) => void
  compact?: boolean
}

export interface MarkdownArtifactProgressCardProps {
  progress: MarkdownGenerationProgress
  sourceDepth: number | null
  compact?: boolean
}

/** 工具参数尚未完整时的原位占位卡：不可点击，也不会打开空的 drawer。 */
export function MarkdownArtifactProgressCard({
  progress,
  sourceDepth,
  compact = false,
}: MarkdownArtifactProgressCardProps) {
  const depthClass =
    sourceDepth !== null && sourceDepth > 0 ? `fc-${dc(sourceDepth)}` : ""
  const hasContent = progress.characterCount > 0
  const detail =
    progress.phase === "starting"
      ? "正在准备文档结构…"
      : hasContent
        ? `已生成 ${progress.characterCount.toLocaleString()} 字符 · ${progress.lineCount.toLocaleString()} 行`
        : "正在起草 Markdown…"

  return (
    <div
      className={`acard acard-progress ${depthClass} ${compact ? "compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="ic progress-icon">
        <span className="progress-spinner">
          <LoaderCircle size={15} aria-hidden="true" />
        </span>
      </span>
      <span className="t">
        <span className="n" style={{ display: "block" }}>
          {progress.partialTitle ?? "正在生成 Markdown"}
        </span>
        <span className="k progress-detail" style={{ display: "block" }}>
          {detail}
        </span>
        {progress.headings.length > 0 ? (
          <span className="progress-heading" style={{ display: "block" }}>
            最近章节 · {progress.headings.join(" / ")}
          </span>
        ) : null}
        <span className="progress-track" aria-hidden="true">
          <span />
        </span>
      </span>
      <span className="go">生成中</span>
    </div>
  )
}

/** 消息流与画布共用的 Artifact 入口；Markdown 是当前主路径，旧 kind 继续兼容。 */
export function MarkdownArtifactCard({
  artifact,
  sourceDepth,
  onOpen,
  compact = false,
}: MarkdownArtifactCardProps) {
  const depthClass =
    sourceDepth !== null && sourceDepth > 0 ? `fc-${dc(sourceDepth)}` : ""
  const isMarkdown = artifact.kind === "markdown"

  return (
    <button
      className={`acard ${depthClass} ${compact ? "compact" : ""}`}
      onClick={() => onOpen(artifact.id)}
    >
      <span className="ic">
        {artifact.kind === "code" ? (
          <FileCode2 size={15} />
        ) : (
          <FileText size={15} />
        )}
      </span>
      <span className="t">
        <span className="n" style={{ display: "block" }}>
          {artifact.title}
        </span>
        <span className="k" style={{ display: "block" }}>
          {isMarkdown
            ? "MARKDOWN"
            : `ARTIFACT · ${artifact.kind === "code" ? (artifact.lang ?? "code") : "note"}`}
        </span>
      </span>
      <span className="go">{isMarkdown ? "打开预览 →" : "抽屉打开 →"}</span>
    </button>
  )
}
