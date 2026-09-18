"use client"

import { DOCUMENT_UI_KEYS } from "@/constants/project-documents"

import React, { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ExternalLink,
  FileText,
  FolderKanban,
  Paperclip,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { ATTACHMENT_ACCEPT } from "@/constants/attachment"
import {
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_TARGET_MAX_CHARS,
  PROJECT_WORKSPACE_COPY,
} from "@/constants/project-workspace"
import type {
  ArtifactDTO,
  ArtifactSummaryDTO,
  ProjectDTO,
  ProjectFileDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import { ArtifactPanel, artifactCaption, formatDate } from "./artifact-panel"
import { MarkdownArtifactCard } from "./markdown-artifact-card"
import { ProjectPanelSkeleton, ResourceListSkeleton } from "./skeleton"
import { toViewThreadId } from "../../core/projections"
import { uploadProjectFile } from "../../net/project-file-upload"
import { accentOf } from "../../theme"
import type { Locale } from "@/constants/i18n"
import { createTranslator } from "@/lib/i18n/dictionary"
import { useI18n } from "@/lib/i18n/client"


export interface ProjectPanelProps {
  project: ProjectDTO | null
  files: ProjectFileDTO[]
  artifacts: ArtifactSummaryDTO[]
  currentArtifacts: ArtifactSummaryDTO[]
  artifactContents: Readonly<Record<string, string>>
  artifactLoadError?: boolean
  onRetryArtifact?(): void
  documentSyncError?: boolean
  renderDocumentControls?(artifact: ArtifactDTO): React.ReactNode
  /** threadId → 分支深度；用于目录卡片缩略图按来源 Thread 着色。 */
  threadDepths?: Readonly<Record<string, number>>
  open: boolean
  activeId: string | null
  threads: Readonly<Record<string, Pick<ThreadDTO, "depth">>>
  onClose(): void
  onSelect(id: string): void
  onLocate(threadId: string, sourceMessageId: string): void
  onSaveContract(target: string, instructions: string): Promise<void>
  onAddProjectFile(attachmentId: string): Promise<void>
  onRemoveProjectFile(attachmentId: string): Promise<void>
}

type ProjectPanelSection = "overview" | "files" | "artifacts"

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileStatusLabel(file: ProjectFileDTO, locale: Locale) {
  const t = createTranslator(locale)
  if (file.status === "ready") return t("ui.ready")
  if (file.status === "failed") return t("ui.failed")
  return t("ui.processing")
}

/**
 * Project 管理屏：概览（Contract）/ 文件 / 文档与产物目录。
 * 选中 Artifact 后整个 drawer 切换为 ArtifactPanel 阅读屏，返回键回到目录——
 * 共享同一个 drawer 壳的导航栈，而不是第二个固定抽屉。
 */
export function ProjectPanel({
  project,
  files,
  artifacts,
  currentArtifacts,
  artifactContents,
  artifactLoadError,
  onRetryArtifact,
  open,
  activeId,
  threads,
  onClose,
  onSelect,
  onLocate,
  onSaveContract,
  onAddProjectFile,
  onRemoveProjectFile,
  renderDocumentControls,
  documentSyncError,
  threadDepths,
}: ProjectPanelProps) {
  const { locale, t } = useI18n()

  const titleId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const [section, setSection] = useState<ProjectPanelSection>("overview")
  const [editing, setEditing] = useState(false)
  const [targetDraft, setTargetDraft] = useState("")
  const [instructionsDraft, setInstructionsDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [artifactQuery, setArtifactQuery] = useState("")
  const archived = Boolean(project?.archivedAt)
  const loading = open && !project
  const displayedSection: ProjectPanelSection = activeId ? "artifacts" : section

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

  const selectedMetadata = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeId) ?? null,
    [activeId, artifacts]
  )
  const selectedContent = activeId ? artifactContents[activeId] : undefined
  const sourceThread = selectedMetadata ? threads[selectedMetadata.threadId] : undefined
  const artifactAccent = sourceThread ? accentOf(sourceThread) : undefined
  const sortedArtifacts = useMemo(() => {
    return currentArtifacts.filter((artifact) => {
      const query = artifactQuery.trim().toLowerCase()
      if (!query) return true
      return [artifact.title, artifact.kind, artifact.sourceThreadTitle ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [artifactQuery, currentArtifacts])
  const sortedFiles = useMemo(
    () =>
      [...files].sort((left, right) => right.addedAt.localeCompare(left.addedAt)),
    [files]
  )

  const selectSection = (next: ProjectPanelSection) => {
    if (next !== "artifacts" && activeId) onSelect("")
    setSection(next)
  }

  const beginEdit = () => {
    if (!project) return
    setTargetDraft(project.target ?? "")
    setInstructionsDraft(project.instructions ?? "")
    setError(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setTargetDraft(project?.target ?? "")
    setInstructionsDraft(project?.instructions ?? "")
    setError(null)
    setEditing(false)
  }

  const saveContract = async () => {
    if (!project || archived) return
    setSaving(true)
    setError(null)
    try {
      await onSaveContract(targetDraft, instructionsDraft)
      setEditing(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : PROJECT_WORKSPACE_COPY.contractConflict
      )
    } finally {
      setSaving(false)
    }
  }

  const upload = async (file: File) => {
    if (!project || archived) return
    setUploading(true)
    setError(null)
    try {
      await uploadProjectFile(file, {
        onAttachmentCreated: onAddProjectFile,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("ui.fileUploadFailed"))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const remove = async (file: ProjectFileDTO) => {
    if (!project || archived) return
    const confirmed = window.confirm(
      t("chat.unlinkFile", { name: file.filename })
    )
    if (!confirmed) return
    setError(null)
    try {
      await onRemoveProjectFile(file.attachmentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("ui.couldNotRemoveTheFile"))
    }
  }

  const locateArtifact = (artifact: ArtifactSummaryDTO) => {
    onLocate(
      toViewThreadId(project?.rootThreadId, artifact.threadId),
      artifact.sourceMessageId
    )
  }

  const reading = Boolean(activeId)

  return (
    <div
      className={`art-drawer project-panel ${open ? "open" : ""} ${reading ? "project-panel-preview" : ""}`}
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
    >
      {reading ? (
        <ArtifactPanel
          key={activeId}
          titleId={titleId}
          artifact={selectedMetadata}
          content={selectedContent}
          loadError={artifactLoadError}
          onRetry={onRetryArtifact}
          onBack={() => {
            setSection("artifacts")
            onSelect("")
          }}
          onClose={onClose}
          onLocate={() => {
            if (selectedMetadata) locateArtifact(selectedMetadata)
          }}
          project={project}
          accent={artifactAccent}
          renderDocumentControls={renderDocumentControls}
        />
      ) : (
        <>
          <div className="art-head project-panel-head">
            <FolderKanban size={16} />
            <h3 id={titleId}>{t("ui.projectWorkspace")}</h3>
            {archived && <span className="project-readonly">{t("ui.readOnly")}</span>}
            <button
              ref={closeButtonRef}
              type="button"
              className="art-x"
              title={t("ui.collapseProjectWorkspace")}
              aria-label={t("ui.collapseProjectWorkspace")}
              onClick={onClose}
            >
              <X size={13} />
            </button>
          </div>

          <div
            className="project-sections"
            role="tablist"
            aria-label={t("ui.projectWorkspace")}
          >
            <button
              className={displayedSection === "overview" ? "on" : ""}
              onClick={() => selectSection("overview")}
            >
              {t("ui.overview")}</button>
            <button
              className={displayedSection === "files" ? "on" : ""}
              onClick={() => selectSection("files")}
            >
              {t("ui.file")}<span>{files.length}</span>
            </button>
            <button
              className={displayedSection === "artifacts" ? "on" : ""}
              onClick={() => selectSection("artifacts")}
            >
              {t("ui.documentsAndArtifacts")}<span>{currentArtifacts.length}</span>
            </button>
          </div>

          {error && <div className="project-error">{error}</div>}
          {archived && (
            <div className="project-readonly-banner">
              {PROJECT_WORKSPACE_COPY.archivedReadOnly}
            </div>
          )}

          <div className="art-body project-panel-body">
            {documentSyncError ? (
              <p role="status">{t(DOCUMENT_UI_KEYS.syncFailed)}</p>
            ) : null}
            {loading && displayedSection === "overview" ? (
              <ProjectPanelSkeleton />
            ) : null}

            {displayedSection === "overview" && !loading && (
              <section className="project-overview">
                <div className="project-section-heading">
                  <div>
                    <h4>{t("ui.goalAndPersistentInstructions")}</h4>
                    <p>
                      {t("ui.changesApplyOnlyToNewGenerations")}</p>
                  </div>
                  {!archived && !editing && project && (
                    <button className="project-secondary" onClick={beginEdit}>
                      <Pencil size={12} /> {t("chat.edit")}</button>
                  )}
                </div>

                <label className="project-field">
                  <span>Target</span>
                  {editing ? (
                    <textarea
                      value={targetDraft}
                      maxLength={PROJECT_TARGET_MAX_CHARS}
                      onChange={(event) => setTargetDraft(event.target.value)}
                      placeholder={t("ui.whatShouldThisProjectAccomplish")}
                      rows={5}
                    />
                  ) : (
                    <div className="project-read-value">
                      {project?.target || t("ui.noGoalSetYet")}
                    </div>
                  )}
                  {editing && (
                    <small>
                      {targetDraft.length}/{PROJECT_TARGET_MAX_CHARS}
                    </small>
                  )}
                </label>

                <label className="project-field">
                  <span>Instructions</span>
                  {editing ? (
                    <textarea
                      value={instructionsDraft}
                      maxLength={PROJECT_INSTRUCTIONS_MAX_CHARS}
                      onChange={(event) =>
                        setInstructionsDraft(event.target.value)
                      }
                      placeholder={t("ui.whatWorkingStyleConstraintsAndPreferences")}
                      rows={10}
                    />
                  ) : (
                    <div className="project-read-value project-instructions-value">
                      {project?.instructions || t("ui.noInstructionsSetYet")}
                    </div>
                  )}
                  {editing && (
                    <small>
                      {instructionsDraft.length}/
                      {PROJECT_INSTRUCTIONS_MAX_CHARS}
                    </small>
                  )}
                </label>

                {editing && (
                  <div className="project-actions">
                    <button
                      className="project-secondary"
                      disabled={saving}
                      onClick={cancelEdit}
                    >
                      {t("common.cancel")}</button>
                    <button
                      className="project-primary"
                      disabled={saving}
                      onClick={() => void saveContract()}
                    >
                      {saving ? t("ui.saving") : t("ui.saveProjectContext")}
                    </button>
                  </div>
                )}
              </section>
            )}

            {displayedSection === "files" && (
              <section className="project-files">
                <div className="project-section-heading">
                  <div>
                    <h4>{t("ui.sourceMaterialSharedAcrossThreads")}</h4>
                    <p>
                      {t("ui.readyFilesMayBeIncludedIn")}</p>
                  </div>
                  {!archived && project && (
                    <>
                      <input
                        ref={fileInputRef}
                        className="project-file-input"
                        type="file"
                        accept={ATTACHMENT_ACCEPT}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0]
                          if (file) void upload(file)
                        }}
                      />
                      <button
                        className="project-primary"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload size={12} />{" "}
                        {uploading ? t("ui.uploading") : t("ui.uploadFile")}
                      </button>
                    </>
                  )}
                </div>

                {loading ? (
                  <ResourceListSkeleton />
                ) : sortedFiles.length === 0 ? (
                  <div className="project-empty">
                    <Paperclip size={18} />
                    <strong>{t("ui.noProjectFilesYet")}</strong>
                    <span>
                      {t("ui.afterUploadingAllThreadsInThis")}</span>
                  </div>
                ) : (
                  <div className="project-resource-list">
                    {sortedFiles.map((file) => (
                      <article
                        className="project-resource-card"
                        key={file.attachmentId}
                      >
                        <div className="project-resource-icon">
                          <Paperclip size={15} />
                        </div>
                        <div className="project-resource-main">
                          <div className="project-resource-title-row">
                            <strong title={file.filename}>{file.filename}</strong>
                            <span className={`project-status ${file.status}`}>
                              {fileStatusLabel(file, locale)}
                            </span>
                          </div>
                          <div className="project-resource-meta">
                            {file.mimeType} · {formatBytes(file.size)}
                            {file.pageCount ? t("chat.pageCount", { count: file.pageCount }) : ""}
                            {` · ${t("common.addedAt", { time: formatDate(file.addedAt, locale) })}`}
                          </div>
                          {file.summary && <p>{file.summary}</p>}
                          {file.error && (
                            <p className="project-file-error">{file.error}</p>
                          )}
                        </div>
                        <div className="project-resource-actions">
                          <a
                            className="project-icon-button"
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            title={t("ui.openFile")}
                          >
                            <ExternalLink size={13} />
                          </a>
                          {!archived && (
                            <button
                              className="project-icon-button danger"
                              title={t("ui.removeFromProject")}
                              onClick={() => void remove(file)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {displayedSection === "artifacts" && (
              <section className="project-artifacts">
                <div className="project-section-heading">
                  <div>
                    <h4>{t("ui.savedResultsAcrossTheProject")}</h4>
                    <p>
                      {t("ui.artifactsFromTheMainThreadAnd")}</p>
                  </div>
                </div>
                <label className="project-search">
                  <Search size={13} />
                  <input
                    value={artifactQuery}
                    onChange={(event) => setArtifactQuery(event.target.value)}
                    placeholder={t("ui.searchByTitleTypeOrSource")}
                  />
                </label>
                {loading ? (
                  <ResourceListSkeleton />
                ) : sortedArtifacts.length === 0 ? (
                  <div className="project-empty">
                    <FileText size={18} />
                    <strong>{t("ui.noArtifactsYet")}</strong>
                    <span>
                      {t("ui.markdownCodeAndNotesGeneratedIn")}</span>
                  </div>
                ) : (
                  <div className="project-resource-list">
                    {sortedArtifacts.map((artifact) => (
                      <MarkdownArtifactCard
                        key={artifact.id}
                        artifact={{
                          id: artifact.id,
                          title: artifact.title,
                          kind: artifact.kind,
                          lang: artifact.language ?? undefined,
                          content: null,
                        }}
                        caption={artifactCaption(artifact, locale)}
                        sourceDepth={threadDepths?.[artifact.threadId] ?? null}
                        onOpen={onSelect}
                        fill
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}
