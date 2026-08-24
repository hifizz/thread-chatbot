import { notFound } from "next/navigation"
import { isValidConversationRouteId } from "@/lib/thread-chat/domain/conversation-route-id"
import { CanonicalThreadChat } from "../canonical/canonical-thread-chat"
import { threadChatMetadata } from "../page-metadata"
import { resolveConversationAuthority } from "@/lib/thread-chat/cutover/conversation-authority"

export const metadata = threadChatMetadata

/**
 * URL 参数是规范 Conversation ID。裸入口负责显式 bootstrap，不再把任意新 UUID
 * 隐式解释为一棵可写 ThreadTree。
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  if (!isValidConversationRouteId(conversationId)) notFound()
  const authority = resolveConversationAuthority()
  if (authority.authority !== "canonical")
    throw new Error("Thread Chat 只允许 canonical Conversation authority")
  return (
    <CanonicalThreadChat
      key={conversationId}
      id={conversationId}
      expectedSchemaVersion={authority.schemaVersion}
      expectedEpoch={authority.epoch}
    />
  )
}
