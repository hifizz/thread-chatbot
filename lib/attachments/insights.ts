import { generateText } from "ai"
import { minimaxModel } from "@/lib/ai/minimax"
import {
  INSIGHTS_INPUT_CHAR_LIMIT,
  SUGGESTED_QUESTION_COUNT,
} from "@/constants/attachment"

// 上传后基于 PDF 文本生成「摘要 + 建议问题」，解决用户面对空白输入框的冷启动问题。
// 用 generateText + 容错 JSON 解析（而非 generateObject），以兼容任意 OpenAI 兼容端点。

export type AttachmentInsights = {
  summary: string
  suggestedQuestions: string[]
}

function buildPrompt(text: string): string {
  return [
    "你是一个文档助手。请阅读以下文档内容，然后：",
    "1. 用 2-4 句话概括这份文档的主题和要点（中文）。",
    `2. 站在读者角度，提出 ${SUGGESTED_QUESTION_COUNT} 个最有价值、最可能被问到的问题（中文，每个问题简短具体）。`,
    "",
    "只返回一个 JSON 对象，不要有任何其他文字或 markdown 代码块，格式：",
    '{"summary": "……", "suggestedQuestions": ["……", "……", "……"]}',
    "",
    "文档内容：",
    text,
  ].join("\n")
}

/** 从模型输出里容错地抽取 JSON 对象（应对模型偶尔包裹 ```json 或前后加解释） */
function parseInsights(raw: string): AttachmentInsights | null {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(
      raw.slice(start, end + 1)
    ) as Partial<AttachmentInsights>
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : ""
    const questions = Array.isArray(obj.suggestedQuestions)
      ? obj.suggestedQuestions.filter(
          (q): q is string => typeof q === "string" && q.trim().length > 0
        )
      : []
    if (!summary && questions.length === 0) return null
    return {
      summary,
      suggestedQuestions: questions.slice(0, SUGGESTED_QUESTION_COUNT),
    }
  } catch {
    return null
  }
}

/**
 * 基于按页文本生成洞察。取前若干页（截到 INSIGHTS_INPUT_CHAR_LIMIT）即可覆盖多数文档的主旨，
 * 无需把全文喂进去，控制成本与延迟。
 */
export async function generateInsights(
  pages: string[]
): Promise<AttachmentInsights | null> {
  const text = pages.join("\n\n").slice(0, INSIGHTS_INPUT_CHAR_LIMIT)
  if (!text.trim()) return null

  const { text: raw } = await generateText({
    model: minimaxModel(),
    prompt: buildPrompt(text),
  })
  return parseInsights(raw)
}
