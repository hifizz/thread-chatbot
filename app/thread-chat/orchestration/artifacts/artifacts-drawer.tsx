"use client"

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import {
  Check,
  Copy,
  FileText,
  FolderOpen,
  LocateFixed,
  Search,
  X,
} from "lucide-react"
import { ARTIFACT_SEARCH_THRESHOLD } from "@/constants/project-workspace"
import type { ArtifactDTO, ProjectDTO } from "@/lib/thread-chat/contracts/dto"
import type { WorkspacePanelSizes, WorkspaceUiState } from "../../core/types"
import { useCopyMarkdown } from "../../chat/actions/use-copy-markdown"
import { MarkdownBody } from "../../chat/message/markdown-body"
import type { DrawerSide } from "../overlays/workspace-overlay-logic"
import { LayeredDrawer } from "./layered-drawer"

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

export interface ArtifactsDrawerProps {
  project: ProjectDTO | null
  artifacts: ArtifactDTO[]
  open: boolean
  activeId: string | null
  zIndex: number
  side: DrawerSide
  topLayer: boolean
  narrow: boolean
  container?: HTMLElement | null | RefObject<HTMLElement | null>
  panelSizes?: WorkspacePanelSizes
  setWorkspace?(next: Partial<WorkspaceUiState>): void
  onActivate(): void
  onClose(): void
  onOpenChangeComplete?(open: boolean): void
  onSelect(id: string | null): void
  onLocate(threadId: string, sourceMessageId: string): void
}

export function ArtifactsDrawer({
  project,
  artifacts,
  open,
  activeId,
  zIndex,
  side,
  topLayer,
  narrow,
  container,
  panelSizes,
  setWorkspace,
  onActivate,
  onClose,
  onOpenChangeComplete,
  onSelect,
  onLocate,
}: ArtifactsDrawerProps) {
  const titleId = useId()
  const listRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const backButtonRef = useRef<HTMLButtonElement | null>(null)
  const listScrollRef = useRef(0)
  const showSearch = artifacts.length >= ARTIFACT_SEARCH_THRESHOLD
  const [searchState, setSearchState] = useState({
    visible: showSearch,
    query: "",
  })
  if (searchState.visible !== showSearch) {
    setSearchState({ visible: showSearch, query: "" })
  }
  const query = searchState.query
  const setQuery = (value: string) =>
    setSearchState({ visible: showSearch, query: value })
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeId) ?? null,
    [activeId, artifacts]
  )
  const filteredArtifacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...artifacts]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .filter((artifact) => {
        if (!normalizedQuery) return true
        return [artifact.title, artifact.kind, artifact.sourceThreadTitle ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      })
  }, [artifacts, query])

  useEffect(() => {
    if (!activeId) return
    detailRef.current?.scrollTo({ top: 0 })
    backButtonRef.current?.focus()
  }, [activeId])

  useEffect(() => {
    if (!selectedArtifact) {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listScrollRef.current
      })
    }
  }, [selectedArtifact])

  const returnToList = () => onSelect(null)
  const selectArtifact = (id: string) => {
    listScrollRef.current = listRef.current?.scrollTop ?? 0
    onSelect(id)
  }
  const locateArtifact = (artifact: ArtifactDTO) => {
    const viewThreadId =
      project?.rootThreadId === artifact.threadId ? "main" : artifact.threadId
    onLocate(viewThreadId, artifact.sourceMessageId)
  }

  return (
    <LayeredDrawer
      open={open}
      zIndex={zIndex}
      side={side}
      topLayer={topLayer}
      onActivate={onActivate}
      onClose={onClose}
      onOpenChangeComplete={onOpenChangeComplete}
      container={container}
      resizable
      narrow={narrow}
      panelSizes={panelSizes}
      setWorkspace={setWorkspace}
      className="artifacts-drawer"
    >
      <section
        className="artifacts-drawer-shell"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        onKeyDownCapture={(event) => {
          if (
            event.key !== "Escape" ||
            event.nativeEvent.isComposing ||
            event.repeat
          )
            return
          if (selectedArtifact) {
            event.preventDefault()
            event.stopPropagation()
            returnToList()
          } else if (query) {
            event.preventDefault()
            event.stopPropagation()
            setQuery("")
          }
        }}
      >
        <header className="art-head artifacts-drawer-head">
          <FolderOpen size={16} aria-hidden="true" />
          <h3 id={titleId}>Artifacts</h3>
          <span className="artifacts-total">{artifacts.length}</span>
          <button
            type="button"
            className="art-x"
            data-layered-drawer-close
            aria-label="关闭 Artifacts"
            title="关闭 Artifacts"
            onClick={onClose}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </header>

        {error ? <div className="project-error">{error}</div> : null}

        {selectedArtifact ? (
          <div className="art-body project-panel-body" ref={detailRef}>
            <div className="project-artifact-detail">
              <button
                ref={backButtonRef}
                className="project-back"
                onClick={returnToList}
              >
                ← 全部 Artifacts
              </button>
              <div className="project-section-heading artifact-detail-heading">
                <div>
                  <div className="project-eyebrow">
                    {artifactKindLabel(selectedArtifact.kind)}
                  </div>
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
                <div className="project-actions">
                  {selectedArtifact.kind === "markdown" ? (
                    <button
                      type="button"
                      className="project-icon-button"
                      aria-label={copied ? "Markdown 已复制" : "复制 Markdown"}
                      title={copied ? "Markdown 已复制" : "复制 Markdown"}
                      onClick={() => void copy(selectedArtifact.content)}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="project-icon-button"
                    aria-label="定位来源消息"
                    title="定位来源消息"
                    onClick={() => locateArtifact(selectedArtifact)}
                  >
                    <LocateFixed size={13} />
                  </button>
                </div>
              </div>
              <div className="project-artifact-content">
                {selectedArtifact.kind === "markdown" ? (
                  <MarkdownBody source={selectedArtifact.content} />
                ) : null}
                {selectedArtifact.kind === "code" ? (
                  <pre className="art-code">{selectedArtifact.content}</pre>
                ) : null}
                {selectedArtifact.kind === "note" ? (
                  <div className="art-note">
                    {selectedArtifact.content
                      .split("\n\n")
                      .map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="art-body artifacts-list-body" ref={listRef}>
            {showSearch ? (
              <label className="project-search">
                <Search size={13} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索标题、类型或来源 Thread"
                  aria-label="搜索 Artifacts"
                />
              </label>
            ) : null}

            {artifacts.length === 0 ? (
              <div className="project-empty artifacts-empty">
                <FileText size={18} aria-hidden="true" />
                <strong>还没有 Artifact</strong>
                <span>在任意 Thread 中生成 Markdown、Code 或 Note 后会出现在这里。</span>
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <div className="project-empty artifacts-empty">
                <Search size={18} aria-hidden="true" />
                <strong>无匹配 Artifact</strong>
                <span>换个标题、类型或来源 Thread 关键词试试。</span>
              </div>
            ) : (
              <div className="project-resource-list dense">
                {filteredArtifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    className="project-resource-card project-artifact-row"
                    onClick={() => selectArtifact(artifact.id)}
                  >
                    <div className="project-resource-icon">
                      <FileText size={13} aria-hidden="true" />
                    </div>
                    <div className="project-resource-main">
                      <div className="project-resource-title-row">
                        <strong>{artifact.title}</strong>
                        <span className="project-kind">
                          {artifactKindLabel(artifact.kind)}
                        </span>
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
          </div>
        )}
      </section>
    </LayeredDrawer>
  )
}
