import { convertToModelMessages, type ModelMessage } from "ai"
import { db } from "@/lib/db"
import { INHERITED_CHAR_BUDGET } from "@/constants/thread-chat"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { PromptBase } from "@/lib/thread-chat/prompt-cache/types"
import {
  promptContentHash,
  promptVisibleCharacters,
} from "@/lib/thread-chat/prompt-cache/hash"
import {
  applyInheritedBudget,
  omittedNoticeText,
} from "@/lib/thread-chat/application/prompt-policy"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"
import { threadQuotePartToModelText } from "@/lib/thread-chat/application/quote-model"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import {
  loadProjectMessagesByIds,
  listThreadMessageRows,
} from "@/lib/thread-chat/persistence/message-repository"
import { findOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"

function messageText(message: ThreadChatUIMessage): string {
  return message.parts
    .filter(
      (
        part
      ): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
}

function asUiMessage(
  row: {
    id: string
    role: "user" | "assistant"
    parts: ThreadChatUIMessage["parts"]
  },
  threadId: string
): ThreadChatUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: stripTransientParts(row.parts),
    metadata: { messageId: row.id, threadId },
  }
}

function withLegacyBranchOrigin(input: {
  messages: ThreadChatUIMessage[]
  anchorText: string | null
  isForked: boolean
}): ThreadChatUIMessage[] {
  if (!input.isForked || !input.anchorText) return input.messages
  const firstUserIndex = input.messages.findIndex(
    (message) => message.role === "user"
  )
  if (firstUserIndex < 0) return input.messages
  const firstUser = input.messages[firstUserIndex]
  if (!firstUser) return input.messages
  if (firstUser.parts.some((part) => part.type === "data-quote")) {
    return input.messages
  }
  const messages = [...input.messages]
  messages[firstUserIndex] = {
    ...firstUser,
    parts: [
      { type: "data-quote", data: { text: input.anchorText } },
      ...firstUser.parts,
    ],
  }
  return messages
}

function convert(messages: ThreadChatUIMessage[]): ModelMessage[] {
  return convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) => {
      if (part.type !== "data-quote") return undefined
      return {
        type: "text",
        text: threadQuotePartToModelText(part.data),
      }
    },
  })
}

export async function compilePromptBase({
  userId,
  threadId,
  excludeAssistantMessageId,
}: {
  userId: string
  threadId: string
  excludeAssistantMessageId?: string
}): Promise<PromptBase> {
  const thread = await findOwnedThread(db, userId, threadId)
  if (!thread) notFound()

  const inheritedRows = await loadProjectMessagesByIds(
    db,
    thread.projectId,
    thread.forkContext
  )
  const byId = new Map(inheritedRows.map((message) => [message.id, message]))
  const inherited = thread.forkContext.map((id) => byId.get(id))
  if (inherited.some((message) => !message)) {
    stateConflict("冻结分支上下文不完整")
  }
  const inheritedUi = inherited.map((row) => asUiMessage(row!, thread.id))
  const budgeted = applyInheritedBudget(
    inheritedUi,
    messageText,
    INHERITED_CHAR_BUDGET
  )
  const inheritedWithNotice: ThreadChatUIMessage[] = [
    ...(budgeted.omitted > 0
      ? [
          {
            id: "inherited-omitted",
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: omittedNoticeText(budgeted.omitted),
              },
            ],
            metadata: {
              messageId: "inherited-omitted",
              threadId: thread.id,
            },
          },
        ]
      : []),
    ...budgeted.kept,
  ]

  const currentRows = await listThreadMessageRows(
    db,
    thread.projectId,
    thread.id
  )
  const currentUi = withLegacyBranchOrigin({
    messages: currentRows
      .filter(
        (message) =>
          message.supersededAt === null &&
          message.id !== excludeAssistantMessageId
      )
      .map((row) => asUiMessage(row, thread.id)),
    anchorText: thread.anchorText,
    isForked: thread.parentId !== null,
  })
  const currentUserIndex = [...currentUi]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "user")?.index
  if (currentUserIndex === undefined) {
    stateConflict("生成缺少当前用户消息")
  }
  const branchHistoryUi = currentUi.slice(0, currentUserIndex)
  const currentUserUiMessage = currentUi[currentUserIndex]
  if (!currentUserUiMessage || currentUserUiMessage.role !== "user") {
    stateConflict("生成当前消息不是用户消息")
  }

  const combined = await resolveAttachmentParts(
    [...inheritedWithNotice, ...branchHistoryUi, currentUserUiMessage],
    userId
  )
  const inheritedEnd = inheritedWithNotice.length
  const branchEnd = inheritedEnd + branchHistoryUi.length
  const resolvedInherited = combined.slice(0, inheritedEnd)
  const resolvedBranchHistory = combined.slice(inheritedEnd, branchEnd)
  const resolvedCurrentUser = combined.slice(branchEnd)

  const inheritedMessages = convert(resolvedInherited)
  const branchHistoryMessages = convert(resolvedBranchHistory)
  const currentUserMessages = convert(resolvedCurrentUser)

  return {
    inheritedMessages,
    branchHistoryMessages,
    currentUserMessages,
    currentUserUiMessage,
    forkContextHash: promptContentHash(inheritedMessages),
    inheritedCharacters: promptVisibleCharacters(inheritedMessages),
    branchHistoryCharacters: promptVisibleCharacters(branchHistoryMessages),
  }
}
