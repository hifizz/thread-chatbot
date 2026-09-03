"use client"

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"
import {
  ExternalLink,
  FolderKanban,
  Paperclip,
  Pencil,
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
import { WORKSPACE_DRAWER } from "@/constants/workspace-drawers"
import type {
  ProjectDTO,
  ProjectFileDTO,
} from "@/lib/thread-chat/contracts/dto"
import { uploadProjectFile } from "../../net/project-file-upload"
import { LayeredDrawer } from "./layered-drawer"

type ProjectDrawerSection = "overview" | "files"

export interface ProjectDrawerProps {
  project: ProjectDTO | null
  files: ProjectFileDTO[]
  open: boolean
  zIndex: number
  topLayer: boolean
  narrow: boolean
  container: HTMLElement | null | RefObject<HTMLElement | null>
  onActivate(): void
  onClose(): void
  onRefresh(): Promise<void>
  onSaveContract(target: string, instructions: string): Promise<void>
  onAddProjectFile(attachmentId: string): Promise<void>
  onRemoveProjectFile(attachmentId: string): Promise<void>
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function fileStatusLabel(file: ProjectFileDTO) {
  if (file.status === "ready") return "可用"
  if (file.status === "failed") return "失败"
  return "处理中"
}

export function ProjectDrawer({
  project,
  files,
  open,
  zIndex,
  topLayer,
  narrow,
  container,
  onActivate,
  onClose,
  onRefresh,
  onSaveContract,
  onAddProjectFile,
  onRemoveProjectFile,
}: ProjectDrawerProps) {
  const titleId = useId()
  const overviewTabId = useId()
  const overviewPanelId = useId()
  const filesTabId = useId()
  const filesPanelId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const overviewTabRef = useRef<HTMLButtonElement | null>(null)
  const filesTabRef = useRef<HTMLButtonElement | null>(null)
  const [section, setSection] = useState<ProjectDrawerSection>("overview")
  const [editing, setEditing] = useState(false)
  const [targetDraft, setTargetDraft] = useState("")
  const [instructionsDraft, setInstructionsDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const archived = Boolean(project?.archivedAt)
  const emptyProjectState = (
    <div className="project-empty">
      <FolderKanban size={18} />
      <strong>Project 尚未创建</strong>
      <span>发送第一条消息后，即可配置 Project 的目标、长期指令和文件。</span>
    </div>
  )

  const sortedFiles = useMemo(
    () =>
      [...files].sort((left, right) =>
        right.addedAt.localeCompare(left.addedAt)
      ),
    [files]
  )

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
      await uploadProjectFile(file, { onAttachmentCreated: onAddProjectFile })
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件上传失败")
      await onRefresh().catch(() => {})
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const remove = async (file: ProjectFileDTO) => {
    if (!project || archived) return
    const confirmed = window.confirm(
      `从 Project 中移除「${file.filename}」？历史消息中的附件不会被删除。`
    )
    if (!confirmed) return
    setError(null)
    try {
      await onRemoveProjectFile(file.attachmentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除文件失败")
    }
  }

  const selectSection = (next: ProjectDrawerSection) => {
    setSection(next)
    requestAnimationFrame(() => {
      ;(next === "overview" ? overviewTabRef : filesTabRef).current?.focus()
    })
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault()
      selectSection("overview")
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      selectSection("files")
      return
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    selectSection(section === "overview" ? "files" : "overview")
  }

  return (
    <LayeredDrawer
      open={open}
      zIndex={zIndex}
      side="right"
      topLayer={topLayer}
      narrow={narrow}
      container={container}
      initialWidth={WORKSPACE_DRAWER.projectWidth}
      className="project-drawer"
      onActivate={onActivate}
      onClose={onClose}
    >
      <div
        className="project-drawer-shell"
        role="dialog"
        aria-modal={false}
        aria-labelledby={titleId}
        onKeyDownCapture={(event) => {
          if (
            editing &&
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            !event.repeat
          ) {
            event.preventDefault()
            event.stopPropagation()
            cancelEdit()
          }
        }}
      >
        <div className="art-head project-panel-head">
          <FolderKanban size={16} />
          <h3 id={titleId}>
            Project
            {project && (
              <span className="project-version">
                v{project.contractVersion}
              </span>
            )}
          </h3>
          {archived && <span className="project-readonly">只读</span>}
          <button
            type="button"
            className="art-x"
            title="收起 Project"
            aria-label="收起 Project"
            data-layered-drawer-close
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>

        <div
          className="project-sections"
          role="tablist"
          aria-label="Project workspace"
        >
          <button
            ref={overviewTabRef}
            id={overviewTabId}
            type="button"
            role="tab"
            className={section === "overview" ? "on" : ""}
            aria-selected={section === "overview"}
            aria-controls={overviewPanelId}
            tabIndex={section === "overview" ? 0 : -1}
            onClick={() => setSection("overview")}
            onKeyDown={onTabKeyDown}
          >
            Overview
          </button>
          <button
            ref={filesTabRef}
            id={filesTabId}
            type="button"
            role="tab"
            className={section === "files" ? "on" : ""}
            aria-selected={section === "files"}
            aria-controls={filesPanelId}
            tabIndex={section === "files" ? 0 : -1}
            onClick={() => setSection("files")}
            onKeyDown={onTabKeyDown}
          >
            Files <span>{files.length}</span>
          </button>
        </div>

        {error && <div className="project-error">{error}</div>}
        {archived && (
          <div className="project-readonly-banner">
            {PROJECT_WORKSPACE_COPY.archivedReadOnly}
          </div>
        )}

        <div className="art-body project-panel-body">
          <section
            id={overviewPanelId}
            role="tabpanel"
            aria-labelledby={overviewTabId}
            hidden={section !== "overview"}
            className="project-overview"
          >
            {!project ? (
              emptyProjectState
            ) : (
              <>
                <div className="project-section-heading">
                  <div>
                    <div className="project-eyebrow">PROJECT CONTRACT</div>
                    <h4>目标与长期指令</h4>
                    <p>
                      保存后只影响之后启动的生成，不改写历史消息、Artifact 或
                      Fork Context。
                    </p>
                  </div>
                  {!archived && !editing && project && (
                    <button className="project-secondary" onClick={beginEdit}>
                      <Pencil size={12} /> 编辑
                    </button>
                  )}
                </div>

                <label className="project-field">
                  <span>Target</span>
                  {editing ? (
                    <textarea
                      value={targetDraft}
                      maxLength={PROJECT_TARGET_MAX_CHARS}
                      onChange={(event) => setTargetDraft(event.target.value)}
                      placeholder="这个 Project 最终希望达成什么？"
                      rows={5}
                    />
                  ) : (
                    <div className="project-read-value">
                      {project?.target || "尚未设置 Target。"}
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
                      placeholder="模型在这个 Project 中应持续遵循哪些工作方式、约束和偏好？"
                      rows={10}
                    />
                  ) : (
                    <div className="project-read-value project-instructions-value">
                      {project?.instructions || "尚未设置 Instructions。"}
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
                      取消
                    </button>
                    <button
                      className="project-primary"
                      disabled={saving}
                      onClick={() => void saveContract()}
                    >
                      {saving ? "保存中…" : "保存 Contract"}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section
            id={filesPanelId}
            role="tabpanel"
            aria-labelledby={filesTabId}
            hidden={section !== "files"}
            className="project-files"
          >
            {!project ? (
              emptyProjectState
            ) : (
              <>
                <div className="project-section-heading">
                  <div>
                    <div className="project-eyebrow">PROJECT FILES</div>
                    <h4>跨 Thread 可用的原始资料</h4>
                    <p>
                      Ready 文件会在统一预算内参与未来生成；移除只解除 Project
                      成员关系。
                    </p>
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
                        {uploading ? "上传中…" : "上传文件"}
                      </button>
                    </>
                  )}
                </div>

                {sortedFiles.length === 0 ? (
                  <div className="project-empty">
                    <Paperclip size={18} />
                    <strong>还没有 Project File</strong>
                    <span>
                      上传资料后，同一 Project 的所有 Thread
                      都可以在后续生成中使用它。
                    </span>
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
                            <strong title={file.filename}>
                              {file.filename}
                            </strong>
                            <span className={`project-status ${file.status}`}>
                              {fileStatusLabel(file)}
                            </span>
                          </div>
                          <div className="project-resource-meta">
                            {file.mimeType} · {formatBytes(file.size)}
                            {file.pageCount ? ` · ${file.pageCount} 页` : ""}
                            {` · 加入于 ${formatDate(file.addedAt)}`}
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
                            title="打开文件"
                            aria-label={`打开文件：${file.filename}`}
                          >
                            <ExternalLink size={13} />
                          </a>
                          {!archived && (
                            <button
                              className="project-icon-button danger"
                              title="从 Project 移除"
                              aria-label={`从 Project 移除：${file.filename}`}
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
              </>
            )}
          </section>
        </div>
      </div>
    </LayeredDrawer>
  )
}
