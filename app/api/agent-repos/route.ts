// GET /api/agent-repos —— 列出 GITHUB_TOKEN 可见的全部仓库。
// 仓库列表只对 admin 成员开放（当前唯一连接是服务端个人 PAT）。

import { listUserRepos } from "@/lib/agent-demo/github"
import { getCurrentUserId } from "@/lib/auth/server"
import { db } from "@/lib/db"
import { adminMembers } from "@/lib/db/admin-schema"
import { eq } from "drizzle-orm"

export const dynamic = "force-dynamic"

async function requireRepoAccess(): Promise<string | null> {
  const userId = await getCurrentUserId()
  if (!userId) return null
  const [member] = await db
    .select({ userId: adminMembers.userId })
    .from(adminMembers)
    .where(eq(adminMembers.userId, userId))
  return member ? userId : null
}

export async function GET() {
  const userId = await requireRepoAccess()
  if (!userId)
    return Response.json({ error: "无权访问仓库列表" }, { status: 403 })
  const token = process.env.GITHUB_TOKEN?.trim()
  if (!token) {
    return Response.json({ error: "缺少 GITHUB_TOKEN" }, { status: 503 })
  }
  try {
    const repos = await listUserRepos(token)
    return Response.json({ repos })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    )
  }
}
