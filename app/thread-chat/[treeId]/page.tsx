import { notFound } from "next/navigation"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { ThreadChatDemo } from "../thread-chat-demo"
import { threadChatMetadata } from "../page-metadata"

export const metadata = threadChatMetadata

/**
 * URL 即 Project 身份：/thread-chat/{treeId} 打开规范化分支会话；直访新 UUID
 * 得到空工作台，首条消息原子创建 Project。路径仍沿用 treeId 参数名以保持 URL/UX。
 */
export default async function ThreadChatTreePage({
  params,
}: {
  params: Promise<{ treeId: string }>
}) {
  const { treeId } = await params
  if (!isValidTreeId(treeId)) notFound()
  return <ThreadChatDemo key={treeId} treeId={treeId} />
}
