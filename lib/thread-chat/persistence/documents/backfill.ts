import { and, asc, eq, gt, isNull } from "drizzle-orm"
import { artifacts, documentRevisions, messages, projects } from "@/lib/db/schema"
import { DOCUMENT_LIMITS } from "@/constants/project-documents"
import { registerDocumentArtifact } from "./writes"
import type { ConversationExecutor, ConversationTransaction } from "../transaction"

/** 一个旧产物一个事务；与生成提交相同的 Project → Message 锁顺序。 */
export async function registerExistingDocumentInTransaction(tx: ConversationTransaction, artifactId: string): Promise<boolean> {
    const [source] = await tx.select().from(artifacts).where(eq(artifacts.id, artifactId))
    if (!source || source.kind !== "markdown") return false
    const [project] = await tx.select().from(projects).where(eq(projects.id, source.projectId)).for("share")
    if (!project) return false
    const [message] = await tx.select().from(messages).where(and(
      eq(messages.id, source.sourceMessageId), eq(messages.projectId, source.projectId),
      eq(messages.threadId, source.threadId),
    )).for("update")
    if (!message) return false
    const [existing] = await tx.select({ id: documentRevisions.id }).from(documentRevisions)
      .where(eq(documentRevisions.artifactId, source.id))
    if (existing) return false
    return Boolean(await registerDocumentArtifact(tx, source, project.userId))
}

export function listUnregisteredDocuments(executor: ConversationExecutor, cursor?: string) {
  return executor.select({ id: artifacts.id }).from(artifacts)
      .innerJoin(messages, and(eq(messages.id, artifacts.sourceMessageId),
        eq(messages.projectId, artifacts.projectId), eq(messages.threadId, artifacts.threadId)))
      .leftJoin(documentRevisions, eq(documentRevisions.artifactId, artifacts.id))
      .where(and(eq(artifacts.kind, "markdown"), eq(messages.role, "assistant"),
        eq(messages.status, "completed"), isNull(documentRevisions.id),
        cursor ? gt(artifacts.id, cursor) : undefined))
      .orderBy(asc(artifacts.id)).limit(DOCUMENT_LIMITS.backfillBatch)
}
