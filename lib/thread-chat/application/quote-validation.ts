import { and, eq } from "drizzle-orm"
import { artifacts, messages } from "@/lib/db/schema"
import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import type { ThreadQuoteDataV1 } from "@/lib/thread-chat/contracts/quote"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import { stateConflict } from "@/lib/thread-chat/application/errors"
import { persistedThreadQuotePartSchema } from "@/lib/thread-chat/contracts/quote"

function quotesFromContent(content: MessageContentInput): ThreadQuoteDataV1[] {
  return content.parts.flatMap((part) =>
    part.type === "quote" ? [part.quote] : []
  )
}

function snapshotKey(quote: ThreadQuoteDataV1): string {
  return JSON.stringify({
    text: quote.text,
    source: quote.source,
  })
}

export async function assertValidQuoteSources(input: {
  tx: ConversationTransaction
  projectId: string
  sourceThreadId: string
  content: MessageContentInput
}): Promise<void> {
  for (const quote of quotesFromContent(input.content)) {
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

/** Edit 只能保留、删除、排序旧 V1 Quote 并修改 comment，不能新增或复制。 */
export function assertEditQuoteSemantics(
  oldParts: ThreadChatUIMessage["parts"],
  content: MessageContentInput
): void {
  const available = new Map<string, number>()
  for (const part of oldParts) {
    if (part.type !== "data-quote") continue
    const parsed = persistedThreadQuotePartSchema.safeParse(part)
    if (!parsed.success || !("schemaVersion" in parsed.data.data)) continue
    const key = snapshotKey(parsed.data.data)
    available.set(key, (available.get(key) ?? 0) + 1)
  }
  for (const quote of quotesFromContent(content)) {
    const key = snapshotKey(quote)
    const count = available.get(key) ?? 0
    if (count <= 0) stateConflict("编辑消息不能新增或复制 Quote")
    available.set(key, count - 1)
  }
}
