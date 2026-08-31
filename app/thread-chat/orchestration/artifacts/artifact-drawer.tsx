"use client"

import { useMemo } from "react"
import type { ArtifactDTO, ProjectDTO } from "@/lib/thread-chat/contracts/dto"
import type { MessageStatus, ThreadTreeState } from "../../core/types"
import { ProjectPanel } from "./project-panel"

export interface ArtifactDrawerProps {
  state: ThreadTreeState
  open: boolean
  activeId: string | null
  onClose(): void
  onSelect(id: string): void
  onLocate(threadId: string, sourceMessageId: string): void
}

const HARNESS_TIMESTAMP = "1970-01-01T00:00:00.000Z"

function sourceStatus(status: MessageStatus | undefined): ArtifactDTO["sourceMessageStatus"] {
  if (status === "stopped") return "stopped"
  if (status === "error") return "failed"
  if (status === "pending" || status === "streaming") return "generating"
  return "completed"
}

/**
 * Gate 3 旧 harness 的薄适配层。生产入口只使用 StoreBoundProjectPanel；这里仅把
 * 旧 ThreadTreeState 转成统一 ProjectPanel 所需 DTO，避免保留第二套 Drawer UI。
 */
export function ArtifactDrawer({
  state,
  open,
  activeId,
  onClose,
  onSelect,
  onLocate,
}: ArtifactDrawerProps) {
  const root = state.threads.main ?? Object.values(state.threads).find((thread) => thread.parentId === null)
  const project = useMemo<ProjectDTO | null>(
    () =>
      root
        ? {
            id: "gate-3-harness-project",
            rootThreadId: root.id,
            autoTitle: root.title || null,
            customTitle: null,
            target: null,
            instructions: null,
            contractVersion: 0,
            archivedAt: null,
            createdAt: HARNESS_TIMESTAMP,
            updatedAt: HARNESS_TIMESTAMP,
          }
        : null,
    [root]
  )
  const artifacts = useMemo<ArtifactDTO[]>(
    () =>
      state.artifactOrder.flatMap((artifactId) => {
        const artifact = state.artifacts[artifactId]
        if (!artifact) return []
        const thread = state.threads[artifact.sourceThreadId]
        const sourceMessage = thread?.messages.find(
          (message) => message.id === artifact.sourceMessageId
        )
        return [
          {
            id: artifact.id,
            projectId: project?.id ?? "gate-3-harness-project",
            threadId: artifact.sourceThreadId,
            sourceMessageId: artifact.sourceMessageId,
            sourceThreadTitle: thread?.title ?? null,
            sourceThreadFootnote: thread?.footnote ?? null,
            sourceMessageStatus: sourceStatus(sourceMessage?.status),
            kind: artifact.kind,
            title: artifact.title,
            content: artifact.content,
            language: artifact.lang ?? null,
            metadata: {},
            createdAt: HARNESS_TIMESTAMP,
            updatedAt: HARNESS_TIMESTAMP,
          },
        ]
      }),
    [project?.id, state.artifactOrder, state.artifacts, state.threads]
  )

  return (
    <ProjectPanel
      project={project}
      files={[]}
      artifacts={artifacts}
      open={open}
      activeId={activeId}
      onClose={onClose}
      onSelect={onSelect}
      onLocate={onLocate}
      onRefresh={() => Promise.resolve()}
      onSaveContract={() => Promise.resolve()}
      onAddProjectFile={() => Promise.resolve()}
      onRemoveProjectFile={() => Promise.resolve()}
    />
  )
}
