// GET /api/agent-repos/branches?repo=owner/name —— 列出分支与默认分支。
// 只对 admin 成员开放。

import { listBranches } from "@/lib/agent-demo/github"
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

export async function GET(req: Request) {
  const userId = await requireRepoAccess()
  if (!userId)
    return Response.json({ error: "无权访问分支列表" }, { status: 403 })
  const token = process.env.GITHUB_TOKEN?.trim()
  if (!token) {
    return Response.json({ error: "缺少 GITHUB_TOKEN" }, { status: 503 })
  }
  const repo = new URL(req.url).searchParams.get("repo")?.replace(/\.git$/, "") ?? ""
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return Response.json({ error: "repo 必须是 owner/name 形式" }, { status: 400 })
  }
  try {
    const data = await listBranches(repo, token)
    return Response.json(data)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    )
  }
}
