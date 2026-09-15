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

/** 按持续文档身份查询当前条目，不要求正文已经加载。 */
export function selectCurrentDocumentArtifact(catalog: ProjectArtifactCatalog, documentId: string): ArtifactSummaryDTO | null {
  const document = catalog.documentsById[documentId]
  const artifact = document && catalog.artifactsById[document.currentArtifactId]
  return artifact ? { ...artifact, sourceMessageStatus: document.sourceMessageStatus } : null
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
