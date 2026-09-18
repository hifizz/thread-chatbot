"use client"

import React from "react"
import { ArrowLeft, LocateFixed, X } from "lucide-react"
import type {
  ArtifactDTO,
  ArtifactSummaryDTO,
  ProjectDTO,
} from "@/lib/thread-chat/contracts/dto"
import { MarkdownBody } from "../../chat/message/markdown-body"
import { toViewThreadId } from "../../core/projections"
import { ArtifactPreviewActions } from "./artifact-preview-actions"
import { ArtifactBodySkeleton } from "./skeleton"
import { DEFAULT_LOCALE, type Locale } from "@/constants/i18n"
import { createTranslator, formatTimestamp } from "@/lib/i18n/dictionary"
import { useI18n } from "@/lib/i18n/client"


export function formatDate(value: string, locale: Locale = DEFAULT_LOCALE) {
  return formatTimestamp(locale, value)
}

export function sourceStatusLabel(status: ArtifactSummaryDTO["sourceMessageStatus"], locale: Locale = DEFAULT_LOCALE) {
  const t = createTranslator(locale)
  if (status === "completed") return t("ui.completed")
  if (status === "stopped") return t("ui.stopped")
  if (status === "failed") return t("ui.failed")
  return t("ui.generating")
}

export function artifactKindLabel(kind: ArtifactSummaryDTO["kind"]) {
  if (kind === "markdown") return "Markdown"
  if (kind === "code") return "Code"
  return "Note"
}

/** 标题旁的短类型徽标：MD / TSX / NOTE。 */
function artifactKindBadge(artifact: ArtifactSummaryDTO) {
  if (artifact.kind === "markdown") return "MD"
  if (artifact.kind === "code")
    return (artifact.language ?? "CODE").toUpperCase()
  return "NOTE"
}

/** 目录卡片副标题：类型 · 版本 · 来源 Thread · 状态 · 时间，一行截断。 */
export function artifactCaption(artifact: ArtifactSummaryDTO, locale: Locale = DEFAULT_LOCALE) {
  const t = createTranslator(locale)
  const parts = [artifactKindLabel(artifact.kind)]
  if (artifact.document) parts.push(`V${artifact.document.revisionNumber}`)
  parts.push(artifact.sourceThreadTitle ?? t("ui.untitledThread"))
  if (artifact.sourceThreadFootnote !== null)
    parts.push(t("common.footnote", { number: artifact.sourceThreadFootnote }))
  parts.push(sourceStatusLabel(artifact.sourceMessageStatus, locale))
  parts.push(formatDate(artifact.createdAt, locale))
  return parts.join(" · ")
}

export interface ArtifactPanelProps {
  titleId: string
  /** 目录元数据；正文中途可能为 null（列表缺失）或 content 未加载。 */
  artifact: ArtifactSummaryDTO | null
  content: string | undefined
  loadError?: boolean
  onRetry?(): void
  onBack(): void
  onClose(): void
  onLocate(): void
  project: ProjectDTO | null
  accent?: string
  renderDocumentControls?(artifact: ArtifactDTO): React.ReactNode
}

/**
 * Artifact 阅读屏：与 Project 管理屏共享同一个 drawer 壳，由 activeId 切换。
 * 信息层级：标题行（返回/标题+类型徽标+版本控制/操作/关闭）
 * → meta 行（来源/时间/状态）→ 正文；版本差异展开为标题行下的浮层。
 */
export function ArtifactPanel({
  titleId,
  artifact,
  content,
  loadError,
  onRetry,
  onBack,
  onClose,
  onLocate,
  project,
  accent,
  renderDocumentControls,
}: ArtifactPanelProps) {
  const { locale, t } = useI18n()

  const selected =
    artifact && content !== undefined ? { ...artifact, content } : null
  const status = artifact ? artifact.sourceMessageStatus : null

  return (
    <>
      <div className="art-head artifact-head">
        <button
          type="button"
          className="artifact-back"
          aria-label={t("ui.backToDocuments")}
          title={t("ui.backToDocuments")}
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="artifact-heading">
          <div className="artifact-title-line">
            <h3 id={titleId} title={artifact?.title}>
              {artifact?.title ?? t("ui.document")}
            </h3>
            {artifact && (
              <span className="artifact-kind">
                · {artifactKindBadge(artifact)}
              </span>
            )}
            {selected?.document && renderDocumentControls?.(selected)}
          </div>
          {artifact && (
            <div className="artifact-meta">
              <button
                type="button"
                className="artifact-meta-source"
                title={t("chat.locateSource", { title: artifact.sourceThreadTitle ?? t("ui.untitledThread") })}
                onClick={onLocate}
              >
                <LocateFixed size={11} />
                <span>{artifact.sourceThreadTitle ?? t("ui.untitledThread")}</span>
              </button>
              <time dateTime={artifact.createdAt}>
                {formatDate(artifact.createdAt, locale)}
              </time>
              {status && status !== "completed" && (
                <span className={`artifact-meta-status ${status}`}>
                  {sourceStatusLabel(status, locale)}
                </span>
              )}
            </div>
          )}
        </div>
        {selected && (
          <ArtifactPreviewActions
            key={selected.id}
            artifact={selected}
            onLocate={onLocate}
          />
        )}
        <button
          type="button"
          className="art-x"
          title={t("ui.closeDocument")}
          aria-label={t("ui.closeDocument")}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="art-body artifact-body">
        {selected ? (
          <div
            className="project-artifact-content tc-accent-context"
            style={{ "--tc-accent": accent } as React.CSSProperties}
            // 把当前 Markdown 阅读区标记成可划选来源；全局唯一 selection
            // observer 据此获得稳定的 artifact/message/thread identity。
            {...(selected.kind === "markdown" && project
              ? {
                  "data-selection-artifact-id": selected.id,
                  "data-selection-message-id": selected.sourceMessageId,
                  "data-selection-thread-id": toViewThreadId(
                    project.rootThreadId,
                    selected.threadId
                  ),
                }
              : {})}
          >
            {selected.kind === "markdown" && (
              <MarkdownBody source={selected.content} density="compact" />
            )}
            {selected.kind === "code" && (
              <pre className="art-code">{selected.content}</pre>
            )}
            {selected.kind === "note" && (
              <div className="art-note">
                {selected.content.split("\n\n").map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            )}
          </div>
        ) : loadError ? (
          <p role="alert">
            {t("ui.couldNotLoadTheDocument")}<button type="button" onClick={onRetry}>
              {t("ui.reload")}</button>
          </p>
        ) : (
          <ArtifactBodySkeleton />
        )}
      </div>
    </>
  )
}
