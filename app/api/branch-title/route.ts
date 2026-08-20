import { generateText } from "ai"
import {
  ARK_BRANCH_TITLE_MAX_OUTPUT_TOKENS,
  ARK_BRANCH_TITLE_MODEL,
} from "@/constants/ark"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { arkCodingChatModel, isArkCodingConfigured } from "@/lib/ai/ark"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"

/**
 * POST /api/branch-title —— 异步分支标题生成（openspec: add-bubble-composer D7）。
 *
 * body：{ anchorText, question, answer }（锚点原文 + 分支首轮问答摘录）。
 * 返回：{ title: string | null } —— null 表示生成失败 / 未配置模型 / 输出为空，
 * 客户端一律静默保留默认标题（锚点截 13 字）。
 *
 * 用火山方舟 Coding Plan 的 Doubao Seed 2.0 Mini + generateText：单次短生成，
 * 不需要 /api/chat 的流式 / 工具管线。
 */

/** 喂给标题模型的首答摘录上限（字符）：标题只需主旨，控制成本与延迟 */
const ANSWER_EXCERPT_LIMIT = 600
/** 同理，问题与锚点原文的截断上限 */
const INPUT_EXCERPT_LIMIT = 200

function buildPrompt(anchorText: string, question: string, answer: string) {
  return (
    "这是一个分支对话：用户阅读 AI 回答时划选了一段文字，就它开启了分支讨论。\n" +
    `被划选的文字：「${anchorText.slice(0, INPUT_EXCERPT_LIMIT)}」\n` +
    `用户的问题：「${question.slice(0, INPUT_EXCERPT_LIMIT)}」\n` +
    `首答摘录：「${answer.slice(0, ANSWER_EXCERPT_LIMIT)}」\n\n` +
    "请根据用户问题所用的语言，为这个分支拟一个简短、清晰、便于扫描的标题，概括这轮讨论的主题。" +
    "中文和英文都使用自然短语；不要为了凑长度或限制长度而删词、截断。" +
    "只输出标题本身，不要引号、标点、序号或任何解释。"
  )
}

/** 清洗模型输出：剥 <think> 推理段 / 引号 / 标点，取首个非空行；空则 null。 */
function sanitizeTitle(raw: string): string | null {
  // 剥 <think>（含未闭合：截断输出可能只有开标签——一路剥到结尾，codex review P3）
  const t = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
  const line = t
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s !== "")
  if (!line) return null
  const cleaned = line
    .replace(/^[「『"'《【\s]+/, "")
    .replace(/[」』"'》】。！？!?，,.…\s]+$/, "")
    .trim()
  // 过短标题（1 字）不如锚点截断的默认标题信息多，视为生成失败（codex review P3）
  if (cleaned.length < 2) return null
  return cleaned
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }
  const { anchorText, question, answer } = (body ?? {}) as Record<
    string,
    unknown
  >
  if (
    typeof anchorText !== "string" ||
    typeof question !== "string" ||
    typeof answer !== "string" ||
    !anchorText.trim() ||
    !question.trim()
  ) {
    return Response.json(
      { error: "anchorText / question / answer 必须为字符串且前两者非空" },
      { status: 400 }
    )
  }

  // 未配置模型：不算错误，客户端静默保留默认标题
  if (!isArkCodingConfigured()) return Response.json({ title: null })

  try {
    const { text } = await generateText({
      model: withModelCallLogging(
        arkCodingChatModel(ARK_BRANCH_TITLE_MODEL),
        MODEL_CALL_PURPOSE.branchTitle,
        { requestId: crypto.randomUUID() }
      ),
      maxOutputTokens: ARK_BRANCH_TITLE_MAX_OUTPUT_TOKENS,
      // 标题是可选增强；配额不足、鉴权失败等确定性错误不应额外消耗两次请求。
      maxRetries: 0,
      prompt: buildPrompt(anchorText, question, answer),
    })
    return Response.json({ title: sanitizeTitle(text) })
  } catch (err) {
    // 生成失败不抛 5xx：语义标题是锦上添花，客户端拿到 null 静默保留默认标题
    console.warn("[branch-title] 标题生成失败：", err)
    return Response.json({ title: null })
  }
}
