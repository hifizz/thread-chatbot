import { z } from "zod"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import { isR2Configured, presignUpload } from "@/lib/storage/r2"
import { ATTACHMENT_POLICIES } from "@/constants/attachment"

const createSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string(),
  size: z.number().int().positive(),
})

/**
 * 附件上传第一步：策略校验 → 建 attachments 行（status=uploading）→ 签发直传 URL。
 * 文件字节不经过本服务器，由浏览器 PUT 到 R2。
 */
export async function POST(req: Request) {
  if (!isR2Configured()) {
    return Response.json(
      {
        error:
          "未配置 R2 存储（R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET），附件功能不可用",
      },
      { status: 503 }
    )
  }

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: "请求参数不合法" }, { status: 400 })
  }
  const { filename, contentType, size } = parsed.data

  const policy = ATTACHMENT_POLICIES[contentType]
  if (!policy) {
    return Response.json(
      { error: `不支持的文件类型：${contentType}` },
      { status: 415 }
    )
  }
  if (size > policy.maxBytes) {
    const limitMb = Math.floor(policy.maxBytes / (1024 * 1024))
    return Response.json(
      { error: `文件超过大小上限（${limitMb}MB）` },
      { status: 413 }
    )
  }

  // key 只由服务端生成：uuid + 白名单扩展名，用户文件名绝不进 key（防路径穿越/枚举）
  const id = crypto.randomUUID()
  const key = `attachments/${id}.${policy.ext}`

  await db.insert(attachments).values({
    id,
    key,
    filename,
    mimeType: contentType,
    size,
    kind: policy.kind,
  })

  const uploadUrl = await presignUpload(key, contentType)
  return Response.json({ id, uploadUrl })
}
