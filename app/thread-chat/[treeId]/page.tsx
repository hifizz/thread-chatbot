import { notFound } from "next/navigation"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { ThreadChatProjectProvider } from "@/lib/thread-chat/client/providers"
import { ThreadChatProject } from "../normalized/thread-chat-project"
import { threadChatMetadata } from "../page-metadata"

export const metadata = threadChatMetadata

/**
 * URL 即树身份：/thread-chat/{treeId} 打开指定的分支树（直访新 UUID = 开新树）。
 * treeId 做 UUID 形状校验（安全阀），不合法 404。key={treeId} 保证切树（如「新对话」
 * 跳转）时 loader/store 整体重挂，不残留上一棵树的内存状态。
 */
export default async function ThreadChatTreePage({
  params,
}: {
  params: Promise<{ treeId: string }>
}) {
  const { treeId: projectId } = await params
  if (!isValidTreeId(projectId)) notFound()
  return (
    <ThreadChatProjectProvider key={projectId} projectId={projectId}>
      <ThreadChatProject projectId={projectId} />
    </ThreadChatProjectProvider>
  )
}
