/**
 * 会话标题生成的客户端请求。服务端保留完整标题；展示层按自己的布局决定是否省略。
 */
import type { ThreadTitleInput } from "@/lib/thread-chat/contracts/title-request"

export type { ThreadTitleInput } from "@/lib/thread-chat/contracts/title-request"

/**
 * 请求一次主线或分支标题生成。模型不可用或未生成有效标题时返回 null；
 * 调用方保留相应的回退标题即可。
 */
export async function requestThreadTitle(
  input: ThreadTitleInput
): Promise<string | null> {
  const res = await fetch("/api/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`POST /api/title ${res.status}`)
  const data = (await res.json()) as { title?: string | null }
  const title = typeof data.title === "string" ? data.title.trim() : ""
  return title || null
}
