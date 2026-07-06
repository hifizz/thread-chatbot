import { CHUNK_OVERLAP, CHUNK_SIZE } from "@/constants/rag"

export type Chunk = {
  /** 1-based 页码，保留以支持带页码的引用溯源 */
  page: number
  content: string
}

/**
 * 把按页文本切成带重叠的定长块，每块记住所属页码。
 * 逐页切分（不跨页合并）以保证页码归属准确——这是「引用回原文页」的前提。
 */
export function chunkPages(pages: string[]): Chunk[] {
  const chunks: Chunk[] = []
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP)

  pages.forEach((pageText, i) => {
    const text = pageText.trim()
    if (!text) return
    if (text.length <= CHUNK_SIZE) {
      chunks.push({ page: i + 1, content: text })
      return
    }
    for (let start = 0; start < text.length; start += step) {
      const content = text.slice(start, start + CHUNK_SIZE).trim()
      if (content) chunks.push({ page: i + 1, content })
      if (start + CHUNK_SIZE >= text.length) break
    }
  })

  return chunks
}
