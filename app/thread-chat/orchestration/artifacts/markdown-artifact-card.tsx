"use client"

import { FileText } from "lucide-react"
import ThinkingState from "@/components/primitives/ThinkingState"
import type { Artifact, MarkdownGenerationProgress } from "../../core/types"
import { dc } from "../../theme"

export interface MarkdownArtifactCardProps {
  artifact: Pick<Artifact, "id" | "title" | "kind" | "lang" | "content">
  sourceDepth: number | null
  onOpen?: (artifactId: string) => void
  compact?: boolean
}

/** Markdown 标记：M + 下箭头，对应 markdown logo 的极简线稿。 */
function MarkdownMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 13.5V6.5l3 3 3-3v7" />
      <path d="M14.5 6.5v4.2" />
      <path d="m12.7 9.1 1.8 1.8 1.8-1.8" />
    </svg>
  )
}

/** 代码文件的 </> 标记。 */
function CodeMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7.5 6.5-3.5 3.5 3.5 3.5" />
      <path d="m12.5 6.5 3.5 3.5-3.5 3.5" />
    </svg>
  )
}

/**
 * Claude 样产物卡左侧的「页面缩略图」：底层露出一页侧边，正面一页里
 * 上方是类型符号、下方两条正文线。高度对齐「标题 + 副标题」两行。
 */
export function ArtifactThumb({ kind }: { kind: Artifact["kind"] }) {
  return (
    <span className="thumb" aria-hidden="true">
      <span className="thumb-back" />
      <span className="thumb-front">
        {kind === "markdown" ? (
          <MarkdownMark />
        ) : kind === "code" ? (
          <CodeMark />
        ) : null}
        <span className="thumb-lines">
          <i />
          <i />
        </span>
      </span>
    </span>
  )
}

function downloadArtifact(
  artifact: Pick<Artifact, "title" | "kind" | "lang" | "content">
) {
  // 归一化客户端可能只载入了元数据；按钮已按 content !== null 门控。
  if (artifact.content === null) return
  const ext =
    artifact.kind === "markdown"
      ? "md"
      : artifact.kind === "code"
        ? (artifact.lang ?? "txt")
        : "txt"
  const name = `${artifact.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "artifact"}.${ext}`
  const url = URL.createObjectURL(
    new Blob([artifact.content], { type: "text/markdown;charset=utf-8" })
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** tool-createMarkdownArtifact part 的最小结构（state 未收窄时的宽松形态）。 */
export interface MarkdownArtifactToolPartShape {
  toolCallId: string
  state?: string
  input?: { title?: unknown } | undefined
  output?: { created?: unknown; artifactId?: unknown } | undefined
}

/**
 * 工具输入流入过程中的原位生成块：思考轨迹外壳（shimmer 标题 + 竖线 +
 * 细滚动窗），body 是正在写入的 Markdown 尾部预览——像 Claude Web 那样
 * 先看到内容在滚动输出，完成后原位替换为 Artifact 卡片。
 */
export function MarkdownArtifactStreamTrace({
  progress,
  compact = false,
}: {
  progress?: MarkdownGenerationProgress
  compact?: boolean
}) {
  const preview = progress?.preview ?? ""
  const active = progress?.partialTitle
    ? `正在生成 ${progress.partialTitle}`
    : "正在生成 Markdown"
  const stats =
    progress && progress.characterCount > 0
      ? `已生成 ${progress.characterCount.toLocaleString()} 字 · ${progress.lineCount.toLocaleString()} 行`
      : progress?.phase === "starting" || !progress
        ? "正在准备文档结构…"
        : "正在起草 Markdown…"

  return (
    <div className={`thinking-trace bui ${compact ? "compact" : ""}`}>
      <ThinkingState
        variant="Coding"
        working
        active={active}
        icon={<FileText aria-hidden className="size-3.5" />}
        revision={preview}
        body={
          <div className="artifact-preview">
            {preview ? (
              <div className="artifact-preview-text">{preview}</div>
            ) : (
              <div className="artifact-preview-empty">{stats}</div>
            )}
            {preview ? (
              <div className="artifact-preview-stats">{stats}</div>
            ) : null}
          </div>
        }
      />
    </div>
  )
}

/** 失败 / 中断 / 等待落库时的静态占位卡：不可点击，不打开空 drawer。 */
function MarkdownArtifactStaticCard({
  title,
  caption,
  sourceDepth,
  compact = false,
  failed = false,
}: {
  title: string
  caption: string
  sourceDepth: number | null
  compact?: boolean
  failed?: boolean
}) {
  const depthClass =
    sourceDepth !== null && sourceDepth > 0 ? `fc-${dc(sourceDepth)}` : ""
  return (
    <div
      className={`acard acard-static tc-fork-context ${depthClass} ${compact ? "compact" : ""} ${failed ? "acard-failed" : ""}`}
      role="status"
    >
      <ArtifactThumb kind="markdown" />
      <span className="t">
        <span className="n">{title}</span>
        <span className="k">{caption}</span>
      </span>
    </div>
  )
}

/**
 * tool-createMarkdownArtifact part 的原位渲染分发：
 *   input 流入中 → 滚动预览生成块；output-available → 正式卡片；
 *   输出未落库 / 失败 / 中断 → 静态占位卡。
 */
export function MarkdownArtifactToolPart({
  part,
  progress,
  artifact,
  sourceDepth,
  settled = false,
  compact = false,
  onOpen,
}: {
  part: MarkdownArtifactToolPartShape
  progress?: MarkdownGenerationProgress
  artifact?: Artifact
  sourceDepth: number | null
  settled?: boolean
  compact?: boolean
  onOpen?: (artifactId: string) => void
}) {
  if (part.state === "output-available") {
    const artifactId =
      typeof part.output?.artifactId === "string"
        ? part.output.artifactId
        : undefined
    const inputTitle =
      typeof part.input?.title === "string" ? part.input.title : undefined
    if (artifact && onOpen) {
      return (
        <MarkdownArtifactCard
          artifact={artifact}
          sourceDepth={sourceDepth}
          onOpen={onOpen}
          compact={compact}
        />
      )
    }
    /* 终态已确认产出，但 artifact 行尚未 reconcile 进 store：先用工具输入的
     * 标题渲染不可点击占位卡，拿到实体后自动替换为可点击卡片。 */
    return (
      <MarkdownArtifactStaticCard
        title={inputTitle ?? artifact?.title ?? "Markdown 文档"}
        caption={artifactId ? "Markdown" : "文档已生成"}
        sourceDepth={sourceDepth}
        compact={compact}
      />
    )
  }
  if (part.state === "output-error" || settled) {
    return (
      <MarkdownArtifactStaticCard
        title="Markdown 文档"
        caption={part.state === "output-error" ? "生成失败" : "生成未完成"}
        sourceDepth={sourceDepth}
        compact={compact}
        failed
      />
    )
  }
  return <MarkdownArtifactStreamTrace progress={progress} compact={compact} />
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
  const caption = isMarkdown
    ? "Markdown"
    : artifact.kind === "code"
      ? (artifact.lang ?? "Code")
      : "Note"

  const inner = (
    <>
      <ArtifactThumb kind={artifact.kind} />
      <span className="t">
        <span className="n">{artifact.title}</span>
        <span className="k">{caption}</span>
      </span>
      {artifact.content !== null && (
        <button
          type="button"
          className="dl"
          aria-label={`下载 ${artifact.title}`}
          onClick={(event) => {
            event.stopPropagation()
            downloadArtifact(artifact)
          }}
        >
          下载
        </button>
      )}
    </>
  )

  if (!onOpen) {
    return (
      <div
        className={`acard acard-static tc-fork-context ${depthClass} ${compact ? "compact" : ""}`}
      >
        {inner}
      </div>
    )
  }
  // 内部有下载按钮，外层不能再用 <button>（嵌套按钮是非法 HTML）。
  return (
    <div
      className={`acard tc-fork-context ${depthClass} ${compact ? "compact" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(artifact.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(artifact.id)
        }
      }}
    >
      {inner}
    </div>
  )
}
