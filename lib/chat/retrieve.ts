import { and, eq, gt, sql } from "drizzle-orm"
import { cosineDistance } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachmentChunks } from "@/lib/db/schema"
import { embedQuery } from "@/lib/ai/embeddings"
import { RETRIEVAL_TOP_K } from "@/constants/rag"

export type RetrievedChunk = {
  page: number
  content: string
  similarity: number
}

/**
 * 向量检索：把 query 向量化后，用 pgvector cosine 距离取该附件下最相关的 topK 个分块。
 * 返回结果带页码，供注入时做引用溯源。
 */
export async function retrieveChunks(
  attachmentId: string,
  query: string,
  topK: number = RETRIEVAL_TOP_K
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedQuery(query)
  const similarity = sql<number>`1 - (${cosineDistance(attachmentChunks.embedding, queryEmbedding)})`

  return db
    .select({
      page: attachmentChunks.page,
      content: attachmentChunks.content,
      similarity,
    })
    .from(attachmentChunks)
    .where(
      and(eq(attachmentChunks.attachmentId, attachmentId), gt(similarity, 0))
    )
    .orderBy(sql`${similarity} desc`)
    .limit(topK)
}

/** 该附件是否已建向量索引 */
export async function hasChunks(attachmentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: attachmentChunks.id })
    .from(attachmentChunks)
    .where(eq(attachmentChunks.attachmentId, attachmentId))
    .limit(1)
  return Boolean(row)
}
