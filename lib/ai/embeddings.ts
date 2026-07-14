import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { embed, embedMany } from "ai"
import { TELEMETRY_FUNCTION_IDS } from "@/constants/observability"

// Embedding 模型走独立的、可配置的 OpenAI 兼容 provider。
// MiniMax 国际站没有可用的 embeddings，因此 RAG 的向量化交给任意 OpenAI 兼容服务
// （如 OpenAI text-embedding-3-small、本地 Ollama、其他兼容端点）。未配置时 RAG 静默降级。

function embeddingModel() {
  const provider = createOpenAICompatible({
    name: "embeddings",
    baseURL: process.env.EMBEDDINGS_BASE_URL!,
    apiKey: process.env.EMBEDDINGS_API_KEY,
  })
  return provider.textEmbeddingModel(
    process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small"
  )
}

/** 批量向量化（入库时用） */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: texts,
    telemetry: { functionId: TELEMETRY_FUNCTION_IDS.ragEmbedTexts },
  })
  return embeddings
}

/** 单条向量化（查询时用） */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    telemetry: { functionId: TELEMETRY_FUNCTION_IDS.ragEmbedQuery },
  })
  return embedding
}
