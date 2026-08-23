import { createHash } from "node:crypto"

import { and, asc, eq } from "drizzle-orm"

import { db } from "../../db"
import { projects, workspaceMembers, workspaces } from "../../db/schema"
import {
  conversationId,
  projectId,
  threadId,
  type ProjectId,
} from "../domain/conversation-model"

function stableUuid(namespace: string, actorUserId: string): string {
  const hex = createHash("sha256")
    .update(`thread-chat:${namespace}:${actorUserId}`)
    .digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** 首次 bootstrap 的稳定实体 ID；并发请求只能竞争同一组唯一键。 */
export function canonicalBootstrapConversationIds(actorUserId: string) {
  return {
    conversationId: conversationId(
      stableUuid("personal-conversation", actorUserId)
    ),
    rootThreadId: threadId(stableUuid("personal-root-thread", actorUserId)),
  }
}

/**
 * 裸入口只负责确保用户拥有一个 Project；Conversation 本身仍由 command API 创建。
 * 稳定 ID 让并发/retry 只能收敛到同一个个人 Workspace/Project。
 */
export async function ensureCanonicalPersonalProject(
  actorUserId: string
): Promise<ProjectId> {
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, actorUserId)
      )
    )
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(
      and(eq(projects.lifecycle, "active"), eq(workspaces.lifecycle, "active"))
    )
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .limit(1)
  if (existing) return projectId(existing.id)

  const workspace = stableUuid("personal-workspace", actorUserId)
  const project = stableUuid("personal-project", actorUserId)
  await db.transaction(async (transaction) => {
    await transaction
      .insert(workspaces)
      .values({ id: workspace, revision: 0, lifecycle: "active" })
      .onConflictDoNothing()
    await transaction
      .insert(workspaceMembers)
      .values({ workspaceId: workspace, userId: actorUserId, role: "owner" })
      .onConflictDoNothing()
    await transaction
      .insert(projects)
      .values({
        id: project,
        workspaceId: workspace,
        title: "默认项目",
        revision: 0,
        lifecycle: "active",
      })
      .onConflictDoNothing()
  })
  return projectId(project)
}
