import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { threads } from "@/lib/db/schema"
import { getCurrentUserId } from "@/lib/auth/server"

export async function GET() {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 })

  const rows = await db
    .select()
    .from(threads)
    .where(eq(threads.userId, userId))
    .orderBy(desc(threads.lastMessageAt), desc(threads.createdAt))
  return Response.json({ threads: rows })
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 })

  const { id }: { id: string } = await req.json()
  // 新建对话归属当前用户；若同 id 已存在（重复初始化）则仅在属于本人时返回。
  const [row] = await db
    .insert(threads)
    .values({ id, userId })
    .onConflictDoUpdate({
      target: threads.id,
      set: { updatedAt: new Date() },
      setWhere: eq(threads.userId, userId),
    })
    .returning()

  if (!row) {
    // 冲突且非本人拥有
    const [existing] = await db
      .select()
      .from(threads)
      .where(and(eq(threads.id, id), eq(threads.userId, userId)))
    if (!existing) return Response.json({ error: "无权访问" }, { status: 403 })
    return Response.json(existing)
  }

  return Response.json(row)
}
