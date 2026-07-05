import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import { deleteObject, isR2Configured, presignDownload } from "@/lib/storage/r2"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * 附件的稳定读取入口：302 到短时效 presigned GET。
 * 消息 parts 里持久化的是本路由的相对路径，presigned URL 每次请求现签，天然不过期。
 */
export async function GET(_req: Request, { params }: RouteContext) {
  if (!isR2Configured()) {
    return Response.json({ error: "未配置 R2 存储" }, { status: 503 })
  }
  const { id } = await params
  const [row] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1)
  if (!row) return Response.json({ error: "附件不存在" }, { status: 404 })

  return Response.redirect(await presignDownload(row.key), 302)
}

/** composer 里移除附件时清理 R2 对象与 DB 行 */
export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params
  const [row] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1)
  if (!row) return Response.json({ ok: true })

  if (isR2Configured()) {
    await deleteObject(row.key).catch(() => {
      // R2 清理失败不阻塞：DB 行删除后对象成为孤儿，可由后台任务兜底回收
    })
  }
  await db.delete(attachments).where(eq(attachments.id, id))
  return Response.json({ ok: true })
}
