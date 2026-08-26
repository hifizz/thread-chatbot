import { convertToModelMessages, type ModelMessage } from "ai"
import { db } from "@/lib/db"
import { INHERITED_CHAR_BUDGET } from "@/constants/thread-chat"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  applyInheritedBudget,
  omittedNoticeText,
} from "@/lib/thread-chat/application/prompt-policy"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"
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

function asUiMessage(row: {
  id: string
  role: "user" | "assistant"
  parts: ThreadChatUIMessage["parts"]
}): ThreadChatUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: stripTransientParts(row.parts),
    metadata: { messageId: row.id, threadId: "context" },
  }
}

/** 返回纯模型消息；system prompt 由生成服务单独注入，不进入持久化上下文。 */
export async function compileModelContext({
  userId,
  threadId,
  excludeAssistantMessageId,
}: {
  userId: string
  threadId: string
  excludeAssistantMessageId?: string
}): Promise<ModelMessage[]> {
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
  const inheritedMessages = inherited.map((row) => asUiMessage(row!))
  const budgeted = applyInheritedBudget(
    inheritedMessages,
    messageText,
    INHERITED_CHAR_BUDGET
  )
  const currentRows = await listThreadMessageRows(
    db,
    thread.projectId,
    thread.id
  )
  const currentMessages = currentRows
    .filter(
      (message) =>
        message.supersededAt === null &&
        message.id !== excludeAssistantMessageId
    )
    .map(asUiMessage)
  const uiMessages: ThreadChatUIMessage[] = [
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
    ...currentMessages,
  ]
  return convertToModelMessages(
    uiMessages.map(({ role, parts, metadata }) => ({ role, parts, metadata })),
    {
      ignoreIncompleteToolCalls: true,
      convertDataPart: (part) => {
        if (part.type !== "data-quote") return undefined
        const data = part.data
        return typeof data === "object" &&
          data !== null &&
          "text" in data &&
          typeof data.text === "string"
          ? { type: "text", text: data.text }
          : undefined
      },
    }
  )
}
