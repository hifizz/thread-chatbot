// RAG（向量检索）相关配置。
// 一期 ChatPDF 对单文档走「全文注入」；当文档过大（超出注入预算）且已建索引时，
// 二期改走向量检索，只把与问题最相关的片段喂给模型。

/**
 * 向量维度。pgvector 的列维度必须在建表时固定，不能随环境变量变化，
 * 因此这里硬编码一个默认值（对应 OpenAI text-embedding-3-small = 1536）。
 * 若更换为不同维度的 embedding 模型，需同步修改此值并重新生成/应用迁移。
 */
export const EMBEDDING_DIMENSIONS = 1536

/** 分块大小（字符）。参考社区实践（AnythingLLM/Open WebUI 约 1000） */
export const CHUNK_SIZE = 1000
/** 相邻分块的重叠字符数，避免把答案切断在边界上 */
export const CHUNK_OVERLAP = 150
/** 检索返回的片段数量 */
export const RETRIEVAL_TOP_K = 6

export function isEmbeddingsConfigured() {
  return Boolean(
    process.env.EMBEDDINGS_API_KEY && process.env.EMBEDDINGS_BASE_URL
  )
}
