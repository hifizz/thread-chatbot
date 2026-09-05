import { and, eq } from "drizzle-orm"
import { getCurrentUserId } from "@/lib/auth/server"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import { getObjectBytes, isR2Configured } from "@/lib/storage/r2"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 })
  if (!isR2Configured()) {
    return Response.json({ error: "文件服务暂不可用" }, { status: 503 })
  }

  const { id } = await params
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .limit(1)

  if (!row) return Response.json({ error: "附件不存在" }, { status: 404 })
  if (row.status !== "ready") {
    return Response.json(
      {
        error:
          row.status === "failed"
            ? "这个文件暂时无法预览"
            : "文件尚未准备好",
      },
      { status: row.status === "failed" ? 422 : 409 }
    )
  }
  if (row.mimeType !== "text/plain") {
    return Response.json({ error: "暂不支持预览这个文件" }, { status: 415 })
  }

  let bytes: Uint8Array
  try {
    bytes = await getObjectBytes(row.key)
  } catch {
    return Response.json({ error: "文件读取失败，请稍后重试" }, { status: 502 })
  }

  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return Response.json({ error: "这个文件暂时无法预览" }, { status: 422 })
  }

  return new Response(content, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
