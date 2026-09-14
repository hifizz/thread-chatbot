import { db } from "@/lib/db"
import { documentUpdatesSchema } from "../../contracts/document"
import type { ReferenceArtifact } from "../../contracts/artifact-reference"
import type { ThreadChatUIMessage } from "../../contracts/ui-message"
import { loadProjectDocumentRevisions, listDocumentCommits } from "../../persistence/documents/queries"
import { expandArtifactReferencesInContext, type DocumentContextEntry } from "../artifact-reference-context"
import { stateConflict } from "../errors"

/** 固定版本一次批量加载；摘要查询不读取历史正文，展开按消息原有顺序执行。 */
export async function expandDocumentUpdates(projectId: string, input: ThreadChatUIMessage[],
  referenceArtifacts: Map<string, ReferenceArtifact> = new Map()): Promise<ThreadChatUIMessage[]> {
  const items = input.flatMap((message) => message.parts.flatMap((part) =>
    part.type === "data-project-document-updates" ? documentUpdatesSchema.parse(part.data).documents : []))
  const [revisions, commits] = await Promise.all([
    loadProjectDocumentRevisions(db, projectId, items.map((item) => item.revisionId)),
    listDocumentCommits(db, projectId, items.flatMap((item) => item.commitIds)),
  ])
  const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]))
  const commitsById = new Map(commits.map((commit) => [commit.id, commit]))
  const entries = new Map<string, DocumentContextEntry>()
  const artifacts = new Map(referenceArtifacts)
  for (const item of items) {
    const revision = revisionsById.get(item.revisionId)
    if (!revision || revision.documentId !== item.documentId || revision.artifactId !== item.artifactId)
      stateConflict("文档上下文版本不完整")
    for (const id of item.commitIds) {
      if (commitsById.get(id)?.documentId !== item.documentId) stateConflict("文档提交记录不完整")
    }
    entries.set(revision.id, { revision, commits: commitsById })
    artifacts.set(revision.artifactId, { id: revision.artifactId, title: revision.title, content: revision.content,
      kind: "markdown", threadId: revision.sourceThreadId, sourceMessageId: revision.sourceMessageId })
  }
  return expandArtifactReferencesInContext(input, artifacts, entries)
}
