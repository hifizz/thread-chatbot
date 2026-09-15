import type { ArtifactDTO } from "../../contracts/dto"

/** 当前文档目录。版本选择集中在这里，消费者只接收每份文档的当前内容。
 * 固定 Artifact 集合仍完整保留，历史引用不得使用此目录回放。
 */
export function currentProjectArtifacts(artifacts: readonly ArtifactDTO[]): ArtifactDTO[] {
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
export function currentDocumentArtifact(artifacts: readonly ArtifactDTO[], documentId: string): ArtifactDTO | null {
  return currentProjectArtifacts(artifacts).find((artifact) => artifact.document?.id === documentId) ?? null
}
