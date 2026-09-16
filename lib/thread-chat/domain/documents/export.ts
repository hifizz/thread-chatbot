import type { ArtifactDTO } from "../../contracts/dto"

/** 导出/系统文件分享只捕获当前所选固定 Artifact，绝不解析 Document head。 */
export function documentExportSnapshot(artifact: ArtifactDTO) {
  const title = artifact.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.md$/i, "").slice(0, 120) || "document"
  const version = artifact.document ? `-v${artifact.document.revisionNumber}` : ""
  return { artifactId: artifact.id, filename: `${title}${version}.md`, content: artifact.content, mimeType: "text/markdown;charset=utf-8" }
}
