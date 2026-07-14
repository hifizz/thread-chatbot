/**
 * net/branch-title —— 异步分支标题的客户端一侧（openspec: add-bubble-composer D7）。
 *
 * 分支首答完成后由壳层（thread-chat-demo）触发一次：POST /api/branch-title
 * 带锚点原文 + 首轮问答，拿回 4–8 字语义标题；成功走 store.setThreadTitle 原子替换，
 * 失败（网络 / 服务端）由调用方 console.warn 静默——默认标题（锚点截 13 字）保留。
 */

export interface BranchTitleInput {
  anchorText: string
  question: string
  answer: string
}

/**
 * 请求生成分支标题。返回语义标题；服务端生成失败 / 输出为空时为 null
 * （调用方保留默认标题即可）。HTTP 失败抛错，由调用方 warn。
 */
export async function requestBranchTitle(
  input: BranchTitleInput
): Promise<string | null> {
  const res = await fetch("/api/branch-title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`POST /api/branch-title ${res.status}`)
  const data = (await res.json()) as { title?: string | null }
  const title = typeof data.title === "string" ? data.title.trim() : ""
  return title || null
}
