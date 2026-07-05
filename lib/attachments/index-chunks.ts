import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachmentChunks } from "@/lib/db/schema"
import { chunkPages } from "@/lib/attachments/chunk"
import { embedTexts } from "@/lib/ai/embeddings"
import { isEmbeddingsConfigured } from "@/constants/rag"

/**
 * 为一个已解析的 PDF 建立向量索引：分块 → 批量向量化 → 写入 attachment_chunks。
 * 幂等：会先清掉该附件已有的分块再重建。未配置 embeddings 时直接跳过（返回 0）。
 * 供上传流程调用；失败不应影响附件本身的可用性（由调用方兜底）。
 */
export async function indexAttachment(
  attachmentId: string,
  pages: string[]
): Promise<number> {
  if (!isEmbeddingsConfigured()) return 0

  const chunks = chunkPages(pages)
  if (chunks.length === 0) return 0

  const embeddings = await embedTexts(chunks.map((c) => c.content))

  await db
    .delete(attachmentChunks)
    .where(eq(attachmentChunks.attachmentId, attachmentId))
  await db.insert(attachmentChunks).values(
    chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      attachmentId,
      page: chunk.page,
      content: chunk.content,
      embedding: embeddings[i],
    }))
  )
  return chunks.length
}
