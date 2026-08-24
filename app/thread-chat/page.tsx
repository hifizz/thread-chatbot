import { ConversationRedirect } from "./conversation-redirect"
import { threadChatMetadata } from "./page-metadata"

export const metadata = threadChatMetadata

/** 裸路径入口跳板：replace 到最近或首次建立的 canonical Conversation。 */
export default function ThreadChatPage() {
  return <ConversationRedirect />
}
