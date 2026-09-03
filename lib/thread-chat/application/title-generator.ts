import { generateText } from "ai"

import {
  THREAD_TITLE_MAX_OUTPUT_TOKENS,
  THREAD_TITLE_MODEL_ID,
} from "@/constants/model"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import {
  isPrivateRelayConfigured,
  privateRelayChatModel,
} from "@/lib/ai/private-relay"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"
import type { ThreadTitleInput } from "@/lib/thread-chat/contracts/title-request"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"

/** 喂给标题模型的首答摘录上限（字符）：标题只需主旨，控制成本与延迟。 */
const ANSWER_EXCERPT_LIMIT = 600
/** 同理，用户问题与分支锚点原文的截断上限。 */
const INPUT_EXCERPT_LIMIT = 200

function buildPrompt(input: ThreadTitleInput): string {
  if (input.kind === "main") {
    return (
      "这是一个新对话的首条用户消息。\n" +
      `用户消息：「${input.question.slice(0, INPUT_EXCERPT_LIMIT)}」\n\n` +
      "请根据用户消息所用的语言，为这个对话拟一个极简标题，只保留核心主题。" +
      "中文尽量控制在 4 至 10 个字，英文尽量控制在 2 至 6 个单词；使用自然短语，不要生硬截断。" +
      "只输出标题本身，不要引号、标点、序号或任何解释。"
    )
  }

  return (
    "这是一个分支对话：用户阅读 AI 回答时划选了一段文字，就它开启了分支讨论。\n" +
    `被划选的文字：「${input.anchorText.slice(0, INPUT_EXCERPT_LIMIT)}」\n` +
    `用户的问题：「${input.question.slice(0, INPUT_EXCERPT_LIMIT)}」\n` +
    `首答摘录：「${input.answer.slice(0, ANSWER_EXCERPT_LIMIT)}」\n\n` +
    "请根据用户问题所用的语言，为这个分支拟一个极简标题，只保留核心主题。" +
    "中文尽量控制在 4 至 10 个字，英文尽量控制在 2 至 6 个单词；使用自然短语，不要生硬截断。" +
    "只输出标题本身，不要引号、标点、序号或任何解释。"
  )
}

/** 清洗模型输出：剥 <think> 推理段 / 引号 / 标点，取首个非空行；空则 null。 */
export function sanitizeGeneratedTitle(raw: string): string | null {
  const text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value !== "")
  if (!line) return null
  const cleaned = line
    .replace(/^[「『"'《【\s]+/, "")
    .replace(/[」』"'》】。！？!?，,.…\s]+$/, "")
    .trim()
  return cleaned.length >= 2 ? cleaned : null
}

export async function generateThreadTitleText(
  input: ThreadTitleInput
): Promise<string | null> {
  if (!isPrivateRelayConfigured()) return null

  try {
    const trace = { requestId: crypto.randomUUID() }
    const { text } = await generateText({
      ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.threadTitle, {
        ...trace,
        modelId: THREAD_TITLE_MODEL_ID,
        entrypoint: "thread-title",
      }),
      model: withModelCallLogging(
        privateRelayChatModel(THREAD_TITLE_MODEL_ID),
        MODEL_CALL_PURPOSE.threadTitle,
        trace
      ),
      maxOutputTokens: THREAD_TITLE_MAX_OUTPUT_TOKENS,
      // 标题是可选增强；配额不足、鉴权失败等确定性错误不应额外消耗请求。
      maxRetries: 0,
      prompt: buildPrompt(input),
    })
    return sanitizeGeneratedTitle(text)
  } catch (error) {
    console.warn("[title] 标题生成失败：", error)
    return null
  }
}
