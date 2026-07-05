import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import {
  deleteObject,
  getObjectBytes,
  headObjectSize,
  isR2Configured,
} from "@/lib/storage/r2"
import {
  extractPdfPages,
  hasTextLayer,
  looksLikePdf,
} from "@/lib/attachments/pdf"
import { ATTACHMENT_POLICIES } from "@/constants/attachment"

type RouteContext = { params: Promise<{ id: string }> }

async function markFailed(id: string, key: string, error: string) {
  // 校验/解析失败的对象一并从 R2 清掉，不留不可用的孤儿文件
  await deleteObject(key).catch(() => {})
  await db
    .update(attachments)
    .set({ status: "failed", error })
    .where(eq(attachments.id, id))
  return Response.json({ status: "failed", error }, { status: 422 })
}

/**
 * 附件上传第二步：浏览器直传完成后调用。
 * 复验实际大小 → PDF 做魔数校验 + 按页提取文本入库 → status=ready。
 * 提取在上传阶段一次完成，对话阶段零解析开销。
 */
export async function POST(_req: Request, { params }: RouteContext) {
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
  if (row.status === "ready") {
    return Response.json({ status: "ready", pageCount: row.pageCount })
  }

  // presign 时只签了 ContentType，大小以 R2 实际值复验（客户端声明不可信）
  const policy = ATTACHMENT_POLICIES[row.mimeType]
  let actualSize: number
  try {
    actualSize = await headObjectSize(row.key)
  } catch {
    return Response.json({ error: "文件尚未上传完成" }, { status: 409 })
  }
  if (policy && actualSize > policy.maxBytes) {
    return markFailed(id, row.key, "文件超过大小上限")
  }

  if (row.mimeType === "application/pdf") {
    const bytes = await getObjectBytes(row.key)
    if (!looksLikePdf(bytes)) {
      return markFailed(id, row.key, "文件内容不是有效的 PDF")
    }
    let extraction
    try {
      extraction = await extractPdfPages(bytes)
    } catch {
      return markFailed(id, row.key, "PDF 解析失败（文件可能已损坏或加密）")
    }
    if (!hasTextLayer(extraction)) {
      // 显式失败优于静默空上下文：扫描件没有文本层，注入空内容只会诱发模型幻觉
      return markFailed(
        id,
        row.key,
        "该 PDF 没有可提取的文本层（可能是扫描件），暂不支持"
      )
    }
    await db
      .update(attachments)
      .set({
        status: "ready",
        size: actualSize,
        pageCount: extraction.pageCount,
        pages: extraction.pages,
      })
      .where(eq(attachments.id, id))
    return Response.json({ status: "ready", pageCount: extraction.pageCount })
  }

  // 非 PDF 类型：仅确认对象存在即就绪（图片/压缩包/视频一期只存储、不解析内容）
  await db
    .update(attachments)
    .set({ status: "ready", size: actualSize })
    .where(eq(attachments.id, id))
  return Response.json({ status: "ready" })
}
