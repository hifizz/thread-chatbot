import { and, eq, inArray } from "drizzle-orm"
import { artifacts, messages } from "@/lib/db/schema"
import { THREAD_QUOTE_SCHEMA_VERSION } from "@/constants/thread-chat"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import { assertQuoteBudget } from "@/lib/thread-chat/application/quote-budget"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import {
  quoteSelectionKey,
  type QuoteSelectionInput,
  type ThreadQuoteDataV1,
} from "@/lib/thread-chat/domain/thread-quote"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

function validationError(message: string): never {
  throw new ConversationApplicationError("VALIDATION_ERROR", message)
}

function completedAssistant(row: {
  role: string
  status: string
  supersededAt: Date | null
}): boolean {
  return (
    row.role === "assistant" &&
    row.status === "completed" &&
    row.supersededAt === null
  )
}

function trimComment(comment: string | undefined): string | undefined {
  const value = comment?.trim()
  return value ? value : undefined
}

export function buildBranchOriginQuote(input: {
  projectId: string
  parentThreadId: string
  sourceMessageId: string
  anchor: TextAnchor
  anchorText: string
  quoteId?: string
}): ThreadQuoteDataV1 {
  if (input.anchor.quote.exact !== input.anchorText) {
    validationError("分支引用正文与 TextAnchor 不一致")
  }
  const quote: ThreadQuoteDataV1 = {
    schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
    quoteId: input.quoteId ?? crypto.randomUUID(),
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
  assertQuoteBudget([quote])
  return quote
}

export async function resolveQuoteSelections(input: {
  tx: ConversationTransaction
  destinationProjectId: string
  destinationThreadId: string
  selections: readonly QuoteSelectionInput[]
  createId?: () => string
}): Promise<ThreadQuoteDataV1[]> {
  const createId = input.createId ?? (() => crypto.randomUUID())
  const uniqueSelections: QuoteSelectionInput[] = []
  const seen = new Set<string>()
  for (const selection of input.selections) {
    const key = quoteSelectionKey(selection)
    if (seen.has(key)) continue
    seen.add(key)
    uniqueSelections.push(selection)
  }

  const messageIds = uniqueSelections.flatMap((selection) =>
    selection.source.type === "message-selection"
      ? [selection.source.sourceMessageId]
      : []
  )
  const artifactIds = uniqueSelections.flatMap((selection) =>
    selection.source.type === "artifact-selection"
      ? [selection.source.artifactId]
      : []
  )

  const messageRows =
    messageIds.length === 0
      ? []
      : await input.tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.projectId, input.destinationProjectId),
              inArray(messages.id, messageIds)
            )
          )
  const messageById = new Map(messageRows.map((row) => [row.id, row]))

  const artifactRows =
    artifactIds.length === 0
      ? []
      : await input.tx
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.projectId, input.destinationProjectId),
              inArray(artifacts.id, artifactIds)
            )
          )
  const artifactById = new Map(artifactRows.map((row) => [row.id, row]))
  const artifactSourceIds = artifactRows.map((row) => row.sourceMessageId)
  const artifactSourceRows =
    artifactSourceIds.length === 0
      ? []
      : await input.tx
          .select()
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

  const resolved = uniqueSelections.map<ThreadQuoteDataV1>((selection) => {
    const comment = trimComment(selection.comment)
    const source = selection.source
    if (source.type === "message-selection") {
      const row = messageById.get(source.sourceMessageId)
      if (!row) validationError("引用来源消息不存在或不属于当前 Project")
      if (row.threadId !== input.destinationThreadId) {
        validationError("v1 只允许引用当前 Thread 内的消息")
      }
      if (!completedAssistant(row)) {
        validationError("只能引用当前 Thread 中已完成的 AI 回复")
      }
      return {
        schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
        quoteId: createId(),
        kind: "selection",
        text: source.anchor.quote.exact,
        ...(comment ? { comment } : {}),
        source: {
          type: "message-selection",
          projectId: input.destinationProjectId,
          threadId: input.destinationThreadId,
          messageId: row.id,
          anchor: source.anchor,
        },
      }
    }

    const artifact = artifactById.get(source.artifactId)
    if (!artifact || artifact.kind !== "markdown") {
      validationError("引用来源 Markdown Artifact 不存在")
    }
    const sourceMessage = artifactSourceById.get(artifact.sourceMessageId)
    if (!sourceMessage) validationError("Artifact 来源消息不存在")
    if (sourceMessage.threadId !== input.destinationThreadId) {
      validationError("v1 只允许批注当前 Thread 产生的 Markdown Artifact")
    }
    if (!completedAssistant(sourceMessage)) {
      validationError("只能批注由已完成 AI 回复产生的 Markdown Artifact")
    }
    return {
      schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
      quoteId: createId(),
      kind: "selection",
      text: source.anchor.quote.exact,
      ...(comment ? { comment } : {}),
      source: {
        type: "artifact-selection",
        projectId: input.destinationProjectId,
        threadId: input.destinationThreadId,
        sourceMessageId: sourceMessage.id,
        artifactId: artifact.id,
        anchor: source.anchor,
      },
    }
  })

  assertQuoteBudget(resolved)
  return resolved
}

export function mergeBranchOriginQuote(
  origin: ThreadQuoteDataV1,
  selections: readonly ThreadQuoteDataV1[]
): ThreadQuoteDataV1[] {
  const originKey = [
    origin.source.type,
    origin.source.type === "message-selection" ? origin.source.messageId : "",
    origin.source.anchor.quote.exact,
    origin.source.anchor.position?.start ?? "",
    origin.source.anchor.position?.end ?? "",
  ].join("\u001f")
  const merged = [
    origin,
    ...selections.filter((quote) => {
      const key = [
        quote.source.type,
        quote.source.type === "message-selection" ? quote.source.messageId : "",
        quote.source.anchor.quote.exact,
        quote.source.anchor.position?.start ?? "",
        quote.source.anchor.position?.end ?? "",
      ].join("\u001f")
      return key !== originKey
    }),
  ]
  assertQuoteBudget(merged)
  return merged
}
