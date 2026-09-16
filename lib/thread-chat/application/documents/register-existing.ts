import { db } from "@/lib/db"
import { withConversationTransaction } from "../../persistence/transaction"
import { listUnregisteredDocuments, registerExistingDocumentInTransaction, type DocumentRegistrationScope } from "../../persistence/documents/backfill"

export function registerExistingDocument(artifactId: string): Promise<boolean> {
  return withConversationTransaction((tx) => registerExistingDocumentInTransaction(tx, artifactId))
}

/** 分页避免一次加载全部历史；失败即停止，重跑时跳过已提交的 Artifact。 */
export function registerExistingDocuments(onProgress?: (registered: number) => void) {
  return registerDocuments(undefined, onProgress)
}

/** 在线入口只补登当前所有者的项目；不按标题过滤，避免漏掉旧产物。 */
export function registerOwnedProjectDocuments(userId: string, projectId: string, artifactId?: string) {
  return registerDocuments({ userId, projectId, artifactId })
}

async function registerDocuments(scope?: DocumentRegistrationScope, onProgress?: (registered: number) => void) {
  let cursor: string | undefined
  let registered = 0
  for (;;) {
    const candidates = await listUnregisteredDocuments(db, cursor, scope)
    if (!candidates.length) return registered
    for (const candidate of candidates) {
      if (await withConversationTransaction((tx) => registerExistingDocumentInTransaction(tx, candidate.id, scope))) registered++
      cursor = candidate.id
      onProgress?.(registered)
    }
  }
}
