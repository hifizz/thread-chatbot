import { NewProjectDraftProvider } from "@/lib/thread-chat/client/providers"
import { threadChatMetadata } from "../page-metadata"
import { ThreadChatNew } from "../normalized/thread-chat-new"

export const metadata = threadChatMetadata

export default function NewThreadChatProjectPage() {
  return (
    <NewProjectDraftProvider>
      <ThreadChatNew />
    </NewProjectDraftProvider>
  )
}
