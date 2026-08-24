import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"

import {
  CONVERSATION_OUTBOX_DEFAULT_BATCH_SIZE,
  CONVERSATION_OUTBOX_MAX_ATTEMPTS,
} from "../../../constants/conversation-command"
import { db } from "../../db"
import { conversationOutboxEvents } from "../../db/schema"
import type {
  ConversationOutboxDispatcher,
  OutboxEventConsumer,
} from "../application/conversation-command-service"
import type { OutboxEvent } from "../application/conversation-command-contracts"

const CLAIM_LEASE_MS = 30_000

function mapEvent(
  row: typeof conversationOutboxEvents.$inferSelect
): OutboxEvent {
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateRevision: row.aggregateRevision,
    type: row.type,
    schemaVersion: 1,
    actorId: row.actorId,
    payload: row.payload,
    attempts: row.attempts,
  }
}

export class DrizzleConversationOutboxDispatcher implements ConversationOutboxDispatcher {
  constructor(
    private readonly consumer: OutboxEventConsumer,
    private readonly workerId: string
  ) {}

  schedule(eventIds: readonly string[]): void {
    if (eventIds.length === 0) return
    queueMicrotask(() => {
      void this.dispatchPending({ eventIds }).catch((error) => {
        console.error("[conversation-outbox] 后台派发失败", {
          eventIds,
          error,
        })
      })
    })
  }

  async dispatchPending(
    input: {
      readonly eventIds?: readonly string[]
      readonly limit?: number
    } = {}
  ): Promise<number> {
    const conditions = [
      inArray(conversationOutboxEvents.status, [
        "pending",
        "failed",
        "processing",
      ]),
      lte(conversationOutboxEvents.availableAt, sql`CURRENT_TIMESTAMP`),
      sql`${conversationOutboxEvents.attempts} < ${CONVERSATION_OUTBOX_MAX_ATTEMPTS}`,
    ]
    if (input.eventIds?.length)
      conditions.push(inArray(conversationOutboxEvents.id, [...input.eventIds]))
    const candidates = await db
      .select({ id: conversationOutboxEvents.id })
      .from(conversationOutboxEvents)
      .where(and(...conditions))
      .orderBy(
        asc(conversationOutboxEvents.availableAt),
        asc(conversationOutboxEvents.createdAt)
      )
      .limit(input.limit ?? CONVERSATION_OUTBOX_DEFAULT_BATCH_SIZE)

    let dispatched = 0
    for (const candidate of candidates) {
      const [claimed] = await db
        .update(conversationOutboxEvents)
        .set({
          status: "processing",
          claimedBy: this.workerId,
          attempts: sql`${conversationOutboxEvents.attempts} + 1`,
          availableAt: sql`CURRENT_TIMESTAMP + (${CLAIM_LEASE_MS} * INTERVAL '1 millisecond')`,
          lastError: null,
        })
        .where(
          and(
            eq(conversationOutboxEvents.id, candidate.id),
            inArray(conversationOutboxEvents.status, [
              "pending",
              "failed",
              "processing",
            ]),
            lte(conversationOutboxEvents.availableAt, sql`CURRENT_TIMESTAMP`)
          )
        )
        .returning()
      if (!claimed) continue
      try {
        await this.consumer.consume(mapEvent(claimed))
        await db
          .update(conversationOutboxEvents)
          .set({
            status: "dispatched",
            dispatchedAt: sql`CURRENT_TIMESTAMP`,
            claimedBy: null,
            lastError: null,
          })
          .where(
            and(
              eq(conversationOutboxEvents.id, claimed.id),
              eq(conversationOutboxEvents.claimedBy, this.workerId),
              eq(conversationOutboxEvents.status, "processing")
            )
          )
        dispatched += 1
      } catch (error) {
        const retryDelayMs = Math.min(30_000, 250 * 2 ** claimed.attempts)
        await db
          .update(conversationOutboxEvents)
          .set({
            status: "failed",
            availableAt: sql`CURRENT_TIMESTAMP + (${retryDelayMs} * INTERVAL '1 millisecond')`,
            claimedBy: null,
            lastError:
              error instanceof Error
                ? error.message.slice(0, 1_000)
                : "unknown",
          })
          .where(eq(conversationOutboxEvents.id, claimed.id))
      }
    }
    return dispatched
  }
}
