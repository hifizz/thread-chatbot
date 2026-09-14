import { and, eq, inArray } from "drizzle-orm"
import { artifacts, documentRevisions } from "@/lib/db/schema"
import { z } from "zod"
import { db } from "@/lib/db"
import { notFound } from "@/lib/thread-chat/application/errors"
import { pendingDocumentUpdates } from "@/lib/thread-chat/application/document-context"
import { listOwnedDocuments } from "@/lib/thread-chat/persistence/document-repository"
import { findOwnedProject, findRootThreadId } from "@/lib/thread-chat/persistence/project-repository"
import { jsonNoCache, withThreadChatRoute, type RouteContext } from "@/lib/thread-chat/server/route-utils"

export async function GET(request: Request, context: RouteContext<{ projectId: string }>) {
  return withThreadChatRoute(request, async (userId) => {
    const projectId = z.uuid().parse((await context.params).projectId)
    if (!await findOwnedProject(db, userId, projectId)) notFound()
    const root = await findRootThreadId(db, projectId)
    if (!root) notFound()
    const pending = await pendingDocumentUpdates(db, projectId, root)
    const commitIds = pending.documents.flatMap((item) => item.commitIds)
    const commits = commitIds.length ? await db.select({ id: documentRevisions.id,
      documentId: documentRevisions.documentId, revisionNumber: documentRevisions.revisionNumber,
      changeSummary: documentRevisions.changeSummary, sourceThreadId: artifacts.threadId,
      sourceMessageId: artifacts.sourceMessageId, createdAt: documentRevisions.createdAt,
    }).from(documentRevisions).innerJoin(artifacts, eq(artifacts.id, documentRevisions.artifactId))
      .where(and(eq(artifacts.projectId, projectId), inArray(documentRevisions.id, commitIds)))
      .orderBy(documentRevisions.documentId, documentRevisions.revisionNumber) : []
    return jsonNoCache({ documents: await listOwnedDocuments(db, userId, projectId), pending, commits })
  })
}
