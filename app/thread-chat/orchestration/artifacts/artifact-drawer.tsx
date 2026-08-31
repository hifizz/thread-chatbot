"use client"

import React, { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ExternalLink,
  FileText,
  FolderKanban,
  LocateFixed,
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
  ProjectDTO,
  ProjectFileDTO,
} from "@/lib/thread-chat/contracts/dto"
import { MarkdownBody } from "../../chat/message/markdown-body"

export type ProjectPanelSection = "overview" | "files" | "artifacts"

export interface ArtifactDrawerProps {
  project: ProjectDTO | null
  files: ProjectFileDTO[]
  artifacts: ArtifactDTO[]
  open: boolean
  activeId: string | null
  onClose: () => void
  onSelect: (id: string) => void
  onLocate: (threadId: string, sourceMessageId: string) => void
  onSaveContract(input: {
    target: string
    instructions: string
    expectedContractVersion: number
  }): Promise<void>
  onUploadFile(file: File): Promise<void>
  onRemoveFile(attachmentId: string): Promise<void>
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

function sourceStatusLabel(status: ArtifactDTO["sourceMessageStatus"]) {
  if (status === "completed") return "已完成"
  if (status === "stopped") return "已停止"
  if (status === "failed") return "失败"
  return "生成中"
}

function artifactKindLabel(kind: ArtifactDTO["kind"]) {
  if (kind === "markdown") return "Markdown"
  if (kind === "code") return "Code"
  return "Note"
}

function fileStatusLabel(file: ProjectFileDTO) {
  if (file.status === "ready") return "可用"
  if (file.status === "failed") return "失败"
  return "处理中"
}

export function ArtifactDrawer({
  project,
  files,
  artifacts,
  open,
  activeId,
  onClose,
  onSelect,
  onLocate,
  onSaveContract,
  onUploadFile,
  onRemoveFile,
}: ArtifactDrawerProps) {
  const titleId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const [section, setSection] = useState<ProjectPanelSection>("overview")
  const [editing, setEditing] = useState(false)
  const [targetDraft, setTargetDraft] = useState(project?.target ?? "")
  const [instructionsDraft, setInstructionsDraft] = useState(
    project?.instructions ?? ""
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [artifactQuery, setArtifactQuery] = useState("")

  const archived = Boolean(project?.archivedAt)
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeId) ?? null,
    [activeId, artifacts]
  )
  const sortedArtifacts = useMemo(
    () =>
      [...artifacts]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .filter((artifact) => {
          const query = artifactQuery.trim().toLowerCase()
          if (!query) return true
          return [artifact.title, artifact.kind, artifact.sourceThreadTitle ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }),
    [artifactQuery, artifacts]
  )
  const sortedFiles = useMemo(
    () => [...files].sort((left, right) => right.addedAt.localeCompare(left.addedAt)),
    [files]
  )

  useEffect(() => {
    if (!project || editing) return
    setTargetDraft(project.target ?? "")
    setInstructionsDraft(project.instructions ?? "")
  }, [editing, project])

  useEffect(() => {
    if (activeId && open) setSection("artifacts")
  }, [activeId, open])

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
      await onSaveContract({
        target: targetDraft,
        instructions: instructionsDraft,
        expectedContractVersion: project.contractVersion,
      })
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : PROJECT_WORKSPACE_COPY.contractConflict)
    } finally {
      setSaving(false)
    }
  }

  const upload = async (file: File) => {
    if (archived) return
    setUploading(true)
    setError(null)
    try {
      await onUploadFile(file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件上传失败")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const remove = async (file: ProjectFileDTO) => {
    if (archived) return
    const confirmed = window.confirm(`从 Project 中移除「${file.filename}」？历史消息中的附件不会被删除。`)
    if (!confirmed) return
    setError(null)
    try {
      await onRemoveFile(file.attachmentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除文件失败")
    }
  }

  return (
    <div
      className={`art-drawer project-panel ${open ? "open" : ""}`}
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="art-head project-panel-head">
        <FolderKanban size={16} />
        <h3 id={titleId}>
          Project
          {project && <span className="project-version">v{project.contractVersion}</span>}
        </h3>
        {archived && <span className="project-readonly">只读</span>}
        <button
          ref={closeButtonRef}
          type="button"
          className="art-x"
          title="收起 Project Panel"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="project-sections" role="tablist" aria-label="Project workspace">
        <button
          className={section === "overview" ? "on" : ""}
          onClick={() => setSection("overview")}
        >
          Overview
        </button>
        <button
          className={section === "files" ? "on" : ""}
          onClick={() => setSection("files")}
        >
          Files <span>{files.length}</span>
        </button>
        <button
          className={section === "artifacts" ? "on" : ""}
          onClick={() => setSection("artifacts")}
        >
          Artifacts <span>{artifacts.length}</span>
        </button>
      </div>

      {error && <div className="project-error">{error}</div>}
      {archived && (
        <div className="project-readonly-banner">{PROJECT_WORKSPACE_COPY.archivedReadOnly}</div>
      )}

      <div className="art-body project-panel-body">
        {section === "overview" && (
          <section className="project-overview">
            <div className="project-section-heading">
              <div>
                <div className="project-eyebrow">PROJECT CONTRACT</div>
                <h4>目标与长期指令</h4>
                <p>保存后只影响之后启动的生成，不改写历史消息、Artifact 或 Fork Context。</p>
              </div>
              {!archived && !editing && project && (
                <button className="project-secondary" onClick={() => setEditing(true)}>
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
                <small>{targetDraft.length}/{PROJECT_TARGET_MAX_CHARS}</small>
              )}
            </label>

            <label className="project-field">
              <span>Instructions</span>
              {editing ? (
                <textarea
                  value={instructionsDraft}
                  maxLength={PROJECT_INSTRUCTIONS_MAX_CHARS}
                  onChange={(event) => setInstructionsDraft(event.target.value)}
                  placeholder="模型在这个 Project 中应持续遵循哪些工作方式、约束和偏好？"
                  rows={10}
                />
              ) : (
                <div className="project-read-value project-instructions-value">
                  {project?.instructions || "尚未设置 Instructions。"}
                </div>
              )}
              {editing && (
                <small>{instructionsDraft.length}/{PROJECT_INSTRUCTIONS_MAX_CHARS}</small>
              )}
            </label>

            {editing && (
              <div className="project-actions">
                <button className="project-secondary" disabled={saving} onClick={cancelEdit}>
                  取消
                </button>
                <button className="project-primary" disabled={saving} onClick={() => void saveContract()}>
                  {saving ? "保存中…" : "保存 Contract"}
                </button>
              </div>
            )}
          </section>
        )}

        {section === "files" && (
          <section className="project-files">
            <div className="project-section-heading">
              <div>
                <div className="project-eyebrow">PROJECT FILES</div>
                <h4>跨 Thread 可用的原始资料</h4>
                <p>Ready 文件会在统一预算内参与未来生成；移除只解除 Project 成员关系。</p>
              </div>
              {!archived && (
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
                    <Upload size={12} /> {uploading ? "上传中…" : "上传文件"}
                  </button>
                </>
              )}
            </div>

            {sortedFiles.length === 0 ? (
              <div className="project-empty">
                <Paperclip size={18} />
                <strong>还没有 Project File</strong>
                <span>上传资料后，同一 Project 的所有 Thread 都可以在后续生成中使用它。</span>
              </div>
            ) : (
              <div className="project-resource-list">
                {sortedFiles.map((file) => (
                  <article className="project-resource-card" key={file.attachmentId}>
                    <div className="project-resource-icon"><Paperclip size={15} /></div>
                    <div className="project-resource-main">
                      <div className="project-resource-title-row">
                        <strong title={file.filename}>{file.filename}</strong>
                        <span className={`project-status ${file.status}`}>{fileStatusLabel(file)}</span>
                      </div>
                      <div className="project-resource-meta">
                        {file.mimeType} · {formatBytes(file.size)}
                        {file.pageCount ? ` · ${file.pageCount} 页` : ""}
                        {` · 加入于 ${formatDate(file.addedAt)}`}
                      </div>
                      {file.summary && <p>{file.summary}</p>}
                      {file.error && <p className="project-file-error">{file.error}</p>}
                    </div>
                    <div className="project-resource-actions">
                      <a className="project-icon-button" href={file.url} target="_blank" rel="noreferrer" title="打开文件">
                        <ExternalLink size={13} />
                      </a>
                      {!archived && (
                        <button className="project-icon-button danger" title="从 Project 移除" onClick={() => void remove(file)}>
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

        {section === "artifacts" && (
          <section className="project-artifacts">
            {selectedArtifact ? (
              <div className="project-artifact-detail">
                <button className="project-back" onClick={() => onSelect("")}>
                  ← 全部 Artifacts
                </button>
                <div className="project-section-heading artifact-detail-heading">
                  <div>
                    <div className="project-eyebrow">{artifactKindLabel(selectedArtifact.kind)}</div>
                    <h4>{selectedArtifact.title}</h4>
                    <p>
                      来源：{selectedArtifact.sourceThreadTitle ?? "未命名 Thread"}
                      {selectedArtifact.sourceThreadFootnote !== null
                        ? ` · 脚注 ${selectedArtifact.sourceThreadFootnote}`
                        : ""}
                      {` · ${sourceStatusLabel(selectedArtifact.sourceMessageStatus)}`}
                      {` · ${formatDate(selectedArtifact.createdAt)}`}
                    </p>
                  </div>
                  <button
                    className="project-secondary"
                    onClick={() =>
                      onLocate(selectedArtifact.threadId, selectedArtifact.sourceMessageId)
                    }
                  >
                    <LocateFixed size={12} /> 定位来源
                  </button>
                </div>
                <div className="project-artifact-content">
                  {selectedArtifact.kind === "markdown" && (
                    <MarkdownBody source={selectedArtifact.content} />
                  )}
                  {selectedArtifact.kind === "code" && (
                    <pre className="art-code">{selectedArtifact.content}</pre>
                  )}
                  {selectedArtifact.kind === "note" && (
                    <div className="art-note">
                      {selectedArtifact.content.split("\n\n").map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="project-section-heading">
                  <div>
                    <div className="project-eyebrow">PROJECT ARTIFACTS</div>
                    <h4>整个 Project 的持久化成果</h4>
                    <p>包含根 Thread 和所有 Fork 产生的 Artifact；仅发现与查看，不会自动注入无关 Thread。</p>
                  </div>
                </div>
                <label className="project-search">
                  <Search size={13} />
                  <input
                    value={artifactQuery}
                    onChange={(event) => setArtifactQuery(event.target.value)}
                    placeholder="搜索标题、类型或来源 Thread"
                  />
                </label>
                {sortedArtifacts.length === 0 ? (
                  <div className="project-empty">
                    <FileText size={18} />
                    <strong>还没有 Artifact</strong>
                    <span>在任意 Thread 中生成 Markdown、Code 或 Note 后会出现在这里。</span>
                  </div>
                ) : (
                  <div className="project-resource-list">
                    {sortedArtifacts.map((artifact) => (
                      <button
                        key={artifact.id}
                        className="project-resource-card project-artifact-row"
                        onClick={() => onSelect(artifact.id)}
                      >
                        <div className="project-resource-icon"><FileText size={15} /></div>
                        <div className="project-resource-main">
                          <div className="project-resource-title-row">
                            <strong>{artifact.title}</strong>
                            <span className="project-kind">{artifactKindLabel(artifact.kind)}</span>
                          </div>
                          <div className="project-resource-meta">
                            {artifact.sourceThreadTitle ?? "未命名 Thread"}
                            {artifact.sourceThreadFootnote !== null
                              ? ` · 脚注 ${artifact.sourceThreadFootnote}`
                              : ""}
                            {` · ${sourceStatusLabel(artifact.sourceMessageStatus)}`}
                            {` · ${formatDate(artifact.createdAt)}`}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
