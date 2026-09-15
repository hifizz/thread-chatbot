import { activeMessagePath } from "../message-graph"
import type { Artifact, ThreadTreeState } from "../types"
import type { ArtifactSummaryDTO } from "../../contracts/dto"

import type { DocumentListItemDTO } from "../../contracts/document"

export interface ProjectArtifactCatalog {
  artifactsById: Readonly<Record<string, ArtifactSummaryDTO>>
  documentsById: Readonly<Record<string, DocumentListItemDTO>>
}

/** 当前身份由服务端目录决定；固定产物缓存不承担版本推断职责。 */
export function selectCurrentProjectArtifacts(catalog: ProjectArtifactCatalog): ArtifactSummaryDTO[] {
  const standalone = Object.values(catalog.artifactsById).filter((artifact) => !artifact.document)
  const current = Object.values(catalog.documentsById).flatMap((document) => {
    const artifact = selectCurrentDocumentArtifact(catalog, document.id)
    return artifact ? [artifact] : []
  })
  return [...standalone, ...current].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** 只给当前版本补目录中的来源状态；固定历史与非文档产物保持自身状态。 */
export function selectArtifactWithCurrentSourceStatus(catalog: ProjectArtifactCatalog, artifactId: string): ArtifactSummaryDTO | null {
  const artifact = catalog.artifactsById[artifactId]
  if (!artifact) return null
  const document = artifact.document && catalog.documentsById[artifact.document.id]
  return document?.currentArtifactId === artifact.id && document.sourceMessageStatus !== artifact.sourceMessageStatus
    ? { ...artifact, sourceMessageStatus: document.sourceMessageStatus } : artifact
}

/** 按持续文档身份查询当前条目，不要求正文已经加载。 */
export function selectCurrentDocumentArtifact(catalog: ProjectArtifactCatalog, documentId: string): ArtifactSummaryDTO | null {
  const document = catalog.documentsById[documentId]
  return document ? selectArtifactWithCurrentSourceStatus(catalog, document.currentArtifactId) : null
}

/** 各 Thread 选中消息路径产生的固定产物；保留历史版本与原有产物顺序。 */
export function selectArtifactsOnSelectedMessagePaths(state: ThreadTreeState): Artifact[] {
  const activeMessageIds = new Set(
    Object.values(state.threads).flatMap((thread) =>
      activeMessagePath(thread).map((message) => message.id)
    )
  )
  return state.artifactOrder.flatMap((artifactId) => {
    const artifact = state.artifacts[artifactId]
    return artifact && activeMessageIds.has(artifact.sourceMessageId)
      ? [artifact]
      : []
  })
}
