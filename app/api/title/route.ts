import { parseThreadTitleInput } from "@/lib/thread-chat/contracts/title-request"
import { generateThreadTitleText } from "@/lib/thread-chat/application/title-generator"

/**
 * POST /api/title —— 主线与分支共用的异步语义标题生成。
 *
 * body：
 * - { kind: "main", question }
 * - { kind: "branch", anchorText, question, answer }
 *
 * 返回：{ title: string | null } —— null 表示生成失败、未配置模型或输出为空；
 * 客户端保留各自的回退标题。
 */

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const input = parseThreadTitleInput(body)
  if (!input) {
    return Response.json({ error: "标题请求参数无效" }, { status: 400 })
  }

  return Response.json({ title: await generateThreadTitleText(input) })
}
