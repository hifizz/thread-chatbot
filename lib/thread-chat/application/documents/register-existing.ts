import { db } from "@/lib/db"
import { withConversationTransaction } from "../../persistence/transaction"
import { listUnregisteredDocuments, registerExistingDocumentInTransaction } from "../../persistence/documents/backfill"

export function registerExistingDocument(artifactId: string): Promise<boolean> {
  return withConversationTransaction((tx) => registerExistingDocumentInTransaction(tx, artifactId))
}

/** 分页避免一次加载全部历史；失败即停止，重跑时跳过已提交的 Artifact。 */
export async function registerExistingDocuments(onProgress?: (registered: number) => void) {
  let cursor: string | undefined
  let registered = 0
  for (;;) {
    const candidates = await listUnregisteredDocuments(db, cursor)
    if (!candidates.length) return registered
    for (const candidate of candidates) {
      if (await registerExistingDocument(candidate.id)) registered++
      cursor = candidate.id
      onProgress?.(registered)
    }
  }
}
