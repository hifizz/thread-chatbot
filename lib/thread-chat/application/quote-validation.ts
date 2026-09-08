import { and, eq } from "drizzle-orm"
import { artifacts, messages } from "@/lib/db/schema"
import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import type { ThreadChatQuoteData, ThreadQuoteDataV1 } from "@/lib/thread-chat/contracts/quote"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import { stateConflict } from "@/lib/thread-chat/application/errors"
import { persistedThreadQuotePartSchema } from "@/lib/thread-chat/contracts/quote"

function quotesFromContent(content: MessageContentInput): ThreadChatQuoteData[] {
  return content.parts.flatMap((part) =>
    part.type === "quote" ? [part.quote] : []
  )
}

function snapshotKey(quote: ThreadChatQuoteData): string {
  return JSON.stringify({
    text: quote.text,
    ...("schemaVersion" in quote ? { schemaVersion: quote.schemaVersion, source: quote.source, comment: quote.comment } : {}),
  })
}

export async function assertValidQuoteSources(input: {
  tx: ConversationTransaction
  projectId: string
  sourceThreadId: string
  content: MessageContentInput
  frozenFirstQuote?: ThreadQuoteDataV1
}): Promise<void> {
  let usedFrozenQuote = false
  for (const quote of quotesFromContent(input.content)) {
    if (input.frozenFirstQuote && snapshotKey(quote) === snapshotKey(input.frozenFirstQuote)) {
      if (usedFrozenQuote) stateConflict("不能重复添加分叉引用")
      usedFrozenQuote = true
      continue
    }
    if (!("schemaVersion" in quote)) stateConflict("旧版 Quote 仅可在原消息编辑时保留")
    const [sourceMessage] = await input.tx
      .select({
        id: messages.id,
        projectId: messages.projectId,
        status: messages.status,
        threadId: messages.threadId,
      })
      .from(messages)
      .where(
        and(
          eq(messages.id, quote.source.messageId),
          eq(messages.projectId, input.projectId)
        )
      )
      .limit(1)
    if (
      !sourceMessage ||
      sourceMessage.status !== "completed" ||
      sourceMessage.threadId !== input.sourceThreadId
    ) {
      stateConflict("Quote 来源消息不属于允许的 Thread 或尚未完成")
    }
    if (quote.source.type === "artifact") {
      const [artifact] = await input.tx
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.id, quote.source.artifactId),
            eq(artifacts.projectId, input.projectId),
            eq(artifacts.sourceMessageId, quote.source.messageId)
          )
        )
        .limit(1)
      if (!artifact) stateConflict("Quote 来源 Artifact 不存在或关系不匹配")
    }
  }
}

/** 原快照子序列检查：可删除，不可新增、复制、重排或改写胶囊。 */
export function assertEditQuoteSemantics(
  oldParts: ThreadChatUIMessage["parts"],
  content: MessageContentInput
): void {
  const available = oldParts.flatMap((part) => part.type === "data-quote"
    ? [snapshotKey(persistedThreadQuotePartSchema.parse(part).data)] : [])
  let next = 0
  for (const quote of quotesFromContent(content)) {
    const index = available.indexOf(snapshotKey(quote), next)
    if (index < 0) stateConflict("引用内容发生变化，请重新打开编辑")
    next = index + 1
  }
}
