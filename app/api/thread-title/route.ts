import { generateText } from "ai"
import {
  ARK_BRANCH_TITLE_MAX_OUTPUT_TOKENS,
  ARK_BRANCH_TITLE_MODEL,
} from "@/constants/ark"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { arkCodingChatModel, isArkCodingConfigured } from "@/lib/ai/ark"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"

/**
 * POST /api/thread-title —— 主线与分支共用的异步语义标题生成。
 *
 * body：
 * - { kind: "main", question }
 * - { kind: "branch", anchorText, question, answer }
 *
 * 返回：{ title: string | null } —— null 表示生成失败、未配置模型或输出为空；
 * 客户端保留各自的回退标题。
 */

/** 喂给标题模型的首答摘录上限（字符）：标题只需主旨，控制成本与延迟 */
const ANSWER_EXCERPT_LIMIT = 600
/** 同理，用户问题与分支锚点原文的截断上限 */
const INPUT_EXCERPT_LIMIT = 200

type ThreadTitleRequest =
  | { kind: "main"; question: string }
  | {
      kind: "branch"
      anchorText: string
      question: string
      answer: string
    }

function buildPrompt(input: ThreadTitleRequest): string {
  if (input.kind === "main") {
    return (
      "这是一个新对话的首条用户消息。\n" +
      `用户消息：「${input.question.slice(0, INPUT_EXCERPT_LIMIT)}」\n\n` +
      "请根据用户消息所用的语言，为这个对话拟一个简短、清晰、便于扫描的标题，概括对话主题。" +
      "中文和英文都使用自然短语；不要为了凑长度或限制长度而删词、截断。" +
      "只输出标题本身，不要引号、标点、序号或任何解释。"
    )
  }

  return (
    "这是一个分支对话：用户阅读 AI 回答时划选了一段文字，就它开启了分支讨论。\n" +
    `被划选的文字：「${input.anchorText.slice(0, INPUT_EXCERPT_LIMIT)}」\n` +
    `用户的问题：「${input.question.slice(0, INPUT_EXCERPT_LIMIT)}」\n` +
    `首答摘录：「${input.answer.slice(0, ANSWER_EXCERPT_LIMIT)}」\n\n` +
    "请根据用户问题所用的语言，为这个分支拟一个简短、清晰、便于扫描的标题，概括这轮讨论的主题。" +
    "中文和英文都使用自然短语；不要为了凑长度或限制长度而删词、截断。" +
    "只输出标题本身，不要引号、标点、序号或任何解释。"
  )
}

function parseRequest(body: unknown): ThreadTitleRequest | null {
  if (!body || typeof body !== "object") return null
  const record = body as Record<string, unknown>
  if (record.kind === "main" && typeof record.question === "string") {
    return record.question.trim() ? { kind: "main", question: record.question } : null
  }
  if (
    (record.kind === "branch" || record.kind === undefined) &&
    typeof record.anchorText === "string" &&
    typeof record.question === "string" &&
    typeof record.answer === "string" &&
    record.anchorText.trim() &&
    record.question.trim()
  ) {
    return {
      kind: "branch",
      anchorText: record.anchorText,
      question: record.question,
      answer: record.answer,
    }
  }
  return null
}

/** 清洗模型输出：剥 <think> 推理段 / 引号 / 标点，取首个非空行；空则 null。 */
function sanitizeTitle(raw: string): string | null {
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

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const input = parseRequest(body)
  if (!input) {
    return Response.json(
      { error: "标题请求参数无效" },
      { status: 400 }
    )
  }

  if (!isArkCodingConfigured()) return Response.json({ title: null })

  try {
    const { text } = await generateText({
      model: withModelCallLogging(
        arkCodingChatModel(ARK_BRANCH_TITLE_MODEL),
        MODEL_CALL_PURPOSE.threadTitle,
        { requestId: crypto.randomUUID() }
      ),
      maxOutputTokens: ARK_BRANCH_TITLE_MAX_OUTPUT_TOKENS,
      // 标题是可选增强；配额不足、鉴权失败等确定性错误不应额外消耗请求。
      maxRetries: 0,
      prompt: buildPrompt(input),
    })
    return Response.json({ title: sanitizeTitle(text) })
  } catch (error) {
    console.warn("[thread-title] 标题生成失败：", error)
    return Response.json({ title: null })
  }
}
