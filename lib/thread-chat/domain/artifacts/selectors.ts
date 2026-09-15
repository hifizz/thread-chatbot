import { activeMessagePath } from "../message-graph"
import type { Artifact, ThreadTreeState } from "../types"
import type { ArtifactDTO } from "../../contracts/dto"

/** 当前文档目录。版本选择集中在这里，消费者只接收每份文档的当前内容。
 * 固定 Artifact 集合仍完整保留，历史引用不得使用此目录回放。
 */
export function selectCurrentProjectArtifacts(artifacts: readonly ArtifactDTO[]): ArtifactDTO[] {
  const documents = new Map<string, ArtifactDTO>()
  const standalone: ArtifactDTO[] = []
  for (const artifact of artifacts) {
    const document = artifact.document
    if (!document) {
      standalone.push(artifact)
      continue
    }
    const previous = documents.get(document.id)
    if (!previous || document.revisionNumber > previous.document!.revisionNumber)
      documents.set(document.id, artifact)
  }
  // 已知 head 尚未加载时不把旧正文冒充当前内容。来源资格由具体操作另行检查，
  // 不能因为新版回复失败或生成中，就悄悄回退到某个 completed 历史版本。
  return [...standalone, ...documents.values()].filter((artifact) => !artifact.document
    || artifact.document.revisionId === artifact.document.currentRevisionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** 调用方只提供持续文档身份，不需要指定或比较版本。 */
export function selectCurrentDocumentArtifact(artifacts: readonly ArtifactDTO[], documentId: string): ArtifactDTO | null {
  return selectCurrentProjectArtifacts(artifacts).find((artifact) => artifact.document?.id === documentId) ?? null
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
