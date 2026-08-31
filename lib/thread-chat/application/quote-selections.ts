import { and, eq, inArray, isNull } from "drizzle-orm"
import { artifacts, messages } from "@/lib/db/schema"
import { MAX_THREAD_QUOTES, THREAD_QUOTE_SCHEMA_VERSION } from "@/constants/prompt-cache"
import { assertQuoteWriteBudget } from "@/lib/thread-chat/application/input-budget"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import {
  quoteSourceDeduplicationKey,
  type QuoteSelectionInput,
  type ThreadQuoteDataV1,
  type ThreadQuoteSourceV1,
} from "@/lib/thread-chat/domain/thread-quote"

function validationError(message: string): never {
  throw new ConversationApplicationError("VALIDATION_ERROR", message)
}

function normalizeComment(value: string | undefined): string | undefined {
  const comment = value?.trim()
  return comment ? comment : undefined
}

function assertAnchor(anchor: TextAnchor): void {
  if (!anchor.quote.exact.trim()) validationError("引用内容不可为空")
  if (
    anchor.position &&
    (anchor.position.start < 0 || anchor.position.end <= anchor.position.start)
  ) {
    validationError("引用位置不合法")
  }
}

export async function resolveQuoteSelections(input: {
  tx: ConversationTransaction
  userId: string
  destinationProjectId: string
  destinationThreadId: string
  selections: readonly QuoteSelectionInput[]
}): Promise<ThreadQuoteDataV1[]> {
  if (input.selections.length > MAX_THREAD_QUOTES) {
    validationError(`每条消息最多引用 ${MAX_THREAD_QUOTES} 段内容`)
  }

  const messageIds = input.selections.flatMap((selection) =>
    selection.source.type === "message-selection"
      ? [selection.source.sourceMessageId]
      : []
  )
  const artifactIds = input.selections.flatMap((selection) =>
    selection.source.type === "artifact-selection"
      ? [selection.source.artifactId]
      : []
  )

  const messageRows =
    messageIds.length === 0
      ? []
      : await input.tx
          .select({
            id: messages.id,
            projectId: messages.projectId,
            threadId: messages.threadId,
            role: messages.role,
            status: messages.status,
            supersededAt: messages.supersededAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.projectId, input.destinationProjectId),
              inArray(messages.id, [...new Set(messageIds)])
            )
          )
  const messageById = new Map(messageRows.map((row) => [row.id, row]))

  const artifactRows =
    artifactIds.length === 0
      ? []
      : await input.tx
          .select({
            id: artifacts.id,
            projectId: artifacts.projectId,
            sourceMessageId: artifacts.sourceMessageId,
          })
          .from(artifacts)
          .where(
            and(
              eq(artifacts.projectId, input.destinationProjectId),
              inArray(artifacts.id, [...new Set(artifactIds)])
            )
          )
  const artifactById = new Map(artifactRows.map((row) => [row.id, row]))
  const artifactSourceIds = [
    ...new Set(artifactRows.map((row) => row.sourceMessageId)),
  ]
  const artifactSourceRows =
    artifactSourceIds.length === 0
      ? []
      : await input.tx
          .select({
            id: messages.id,
            projectId: messages.projectId,
            threadId: messages.threadId,
            role: messages.role,
            status: messages.status,
            supersededAt: messages.supersededAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.projectId, input.destinationProjectId),
              inArray(messages.id, artifactSourceIds)
            )
          )
  const artifactSourceById = new Map(
    artifactSourceRows.map((row) => [row.id, row])
  )

  const resolved: ThreadQuoteDataV1[] = []
  const seen = new Set<string>()
  for (const selection of input.selections) {
    assertAnchor(selection.source.anchor)
    let source: ThreadQuoteSourceV1
    if (selection.source.type === "message-selection") {
      const row = messageById.get(selection.source.sourceMessageId)
      if (!row) validationError("引用来源不存在或无权访问")
      if (
        row.projectId !== input.destinationProjectId ||
        row.threadId !== input.destinationThreadId ||
        row.role !== "assistant" ||
        row.status !== "completed" ||
        row.supersededAt !== null
      ) {
        validationError("只能引用当前 Thread 中已完成的 AI 回复")
      }
      source = {
        type: "message-selection",
        projectId: row.projectId,
        threadId: row.threadId,
        messageId: row.id,
        anchor: selection.source.anchor,
      }
    } else {
      const artifact = artifactById.get(selection.source.artifactId)
      if (!artifact) validationError("引用的 Markdown Artifact 不存在")
      const sourceMessage = artifactSourceById.get(artifact.sourceMessageId)
      if (
        artifact.projectId !== input.destinationProjectId ||
        !sourceMessage ||
        sourceMessage.threadId !== input.destinationThreadId ||
        sourceMessage.role !== "assistant" ||
        sourceMessage.status !== "completed" ||
        sourceMessage.supersededAt !== null
      ) {
        validationError("只能批注当前 Thread 已完成回复产生的 Artifact")
      }
      source = {
        type: "artifact-selection",
        projectId: artifact.projectId,
        threadId: sourceMessage.threadId,
        sourceMessageId: sourceMessage.id,
        artifactId: artifact.id,
        anchor: selection.source.anchor,
      }
    }

    const key = quoteSourceDeduplicationKey(source)
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push({
      schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
      quoteId: crypto.randomUUID(),
      kind: "selection",
      text: source.anchor.quote.exact,
      ...(normalizeComment(selection.comment)
        ? { comment: normalizeComment(selection.comment) }
        : {}),
      source,
    })
  }
  assertQuoteWriteBudget(resolved)
  return resolved
}

export function buildBranchOriginQuote(input: {
  projectId: string
  parentThreadId: string
  sourceMessageId: string
  anchor: TextAnchor
  anchorText: string
}): ThreadQuoteDataV1 {
  if (input.anchor.quote.exact !== input.anchorText) {
    validationError("分支引用正文与来源 Anchor 不一致")
  }
  const quote: ThreadQuoteDataV1 = {
    schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
    quoteId: crypto.randomUUID(),
    kind: "branch-origin",
    text: input.anchorText,
    source: {
      type: "message-selection",
      projectId: input.projectId,
      threadId: input.parentThreadId,
      messageId: input.sourceMessageId,
      anchor: input.anchor,
    },
  }
  assertQuoteWriteBudget([quote])
  return quote
}

export function mergeBranchOriginWithQuotes(
  origin: ThreadQuoteDataV1,
  quotes: readonly ThreadQuoteDataV1[]
): ThreadQuoteDataV1[] {
  const originKey = quoteSourceDeduplicationKey(origin.source)
  const merged = [
    origin,
    ...quotes.filter(
      (quote) => quoteSourceDeduplicationKey(quote.source) !== originKey
    ),
  ]
  assertQuoteWriteBudget(merged)
  return merged
}
