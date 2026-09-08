import type { ThreadComposerDraft } from "./contracts/composer"
import type { ThreadChatUIMessage } from "./contracts/ui-message"
import { messageContentInputSchema, messagePartsToContent, normalizeMessageContentParts, type MessageContentInput } from "./contracts/message-content"

/** localId 只在编辑器边界生成，不进入消息协议。 */
export function messageContentToComposerDraft(content: MessageContentInput, createId = () => crypto.randomUUID()): ThreadComposerDraft {
  return { parts: content.parts.map((part) => ({ ...part, localId: createId() })) }
}

export function messagePartsToComposerDraft(parts: ThreadChatUIMessage["parts"], createId = () => crypto.randomUUID()): ThreadComposerDraft {
  return messageContentToComposerDraft(messagePartsToContent(parts), createId)
}

export function composerDraftToMessageContent(draft: ThreadComposerDraft): MessageContentInput {
  return messageContentInputSchema.parse({
    parts: normalizeMessageContentParts(draft.parts.map(({ localId, ...part }) => {
      void localId
      return part
    })),
  })
}
