import type { Metadata } from "next"

/** /thread-chat 与 /thread-chat/[treeId] 共用的页面 metadata（两个路由是同一页面的跳板与本体） */
export const threadChatMetadata: Metadata = {
  title: "Thread Chat · 分支对话",
  description:
    "划选 AI 回复文字即可开分支的树状对话，接入 MiniMax 实时流式回复。",
}
