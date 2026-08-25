import { notFound } from "next/navigation"
import { idSchema } from "@/lib/thread-chat/api/contracts"
import { ThreadChatProjectProvider } from "@/lib/thread-chat/client/providers"
import { ThreadChatProject } from "../normalized/thread-chat-project"
import { threadChatMetadata } from "../page-metadata"

export const metadata = threadChatMetadata

/** Project ID 是 URL 中唯一的服务端领域身份；不存在或不属于当前 actor 时由 API 拒绝。 */
export default async function ThreadChatProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  if (!idSchema.safeParse(projectId).success) notFound()
  return (
    <ThreadChatProjectProvider key={projectId} projectId={projectId}>
      <ThreadChatProject projectId={projectId} />
    </ThreadChatProjectProvider>
  )
}
