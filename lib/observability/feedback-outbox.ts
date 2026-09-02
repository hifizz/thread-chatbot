import type { FeedbackScoreValue } from "@/lib/observability/feedback-score"
import {
  mirrorMessageFeedback,
  type FeedbackMirrorInput,
  type FeedbackMirrorResult,
} from "@/lib/observability/feedback-score"

export type FeedbackOutboxItem = {
  messageId: string
  value: FeedbackScoreValue
  sourceUpdatedAt: Date
  version: number
  attempts: number
  lockToken: string
}

export type FeedbackOutboxStore = {
  claim(input: {
    messageId?: string
    limit: number
    now: Date
    leaseMs: number
  }): Promise<FeedbackOutboxItem[]>
  succeed(
    item: FeedbackOutboxItem,
    now: Date
  ): Promise<"acknowledged" | "superseded">
  fail(input: {
    item: FeedbackOutboxItem
    errorCategory: string
    now: Date
    nextAttemptAt: Date
  }): Promise<"rescheduled" | "superseded">
}

export type FeedbackOutboxDrainSummary = {
  claimed: number
  mirrored: number
  superseded: number
  retried: number
  skipped: number
}

function retryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempts, 8))
}

export const databaseFeedbackOutboxStore: FeedbackOutboxStore = {
  async claim(input) {
    const [{ and, asc, eq, gt, inArray, isNull, lte, or }, { db }, schema] =
      await Promise.all([
        import("drizzle-orm"),
        import("@/lib/db"),
        import("@/lib/db/schema"),
      ])
    return db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(schema.feedbackScoreOutbox)
        .where(
          and(
            gt(
              schema.feedbackScoreOutbox.version,
              schema.feedbackScoreOutbox.deliveredVersion
            ),
            lte(schema.feedbackScoreOutbox.nextAttemptAt, input.now),
            or(
              isNull(schema.feedbackScoreOutbox.lockedUntil),
              lte(schema.feedbackScoreOutbox.lockedUntil, input.now)
            ),
            ...(input.messageId
              ? [eq(schema.feedbackScoreOutbox.messageId, input.messageId)]
              : [])
          )
        )
        .orderBy(asc(schema.feedbackScoreOutbox.nextAttemptAt))
        .limit(input.limit)
        .for("update", { skipLocked: true })
      if (due.length === 0) return []
      const lockToken = crypto.randomUUID()
      await tx
        .update(schema.feedbackScoreOutbox)
        .set({
          lockToken,
          lockedUntil: new Date(input.now.getTime() + input.leaseMs),
          updatedAt: input.now,
        })
        .where(
          inArray(
            schema.feedbackScoreOutbox.messageId,
            due.map((row) => row.messageId)
          )
        )
      return due.map((row) => ({
        messageId: row.messageId,
        value: row.value,
        sourceUpdatedAt: row.sourceUpdatedAt,
        version: row.version,
        attempts: row.attempts,
        lockToken,
      }))
    })
  },

  async succeed(item, now) {
    const [{ and, eq, gt }, { db }, schema] = await Promise.all([
      import("drizzle-orm"),
      import("@/lib/db"),
      import("@/lib/db/schema"),
    ])
    const acknowledged = await db
      .update(schema.feedbackScoreOutbox)
      .set({
        deliveredVersion: item.version,
        attempts: 0,
        lockedUntil: null,
        lockToken: null,
        lastErrorCategory: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.feedbackScoreOutbox.messageId, item.messageId),
          eq(schema.feedbackScoreOutbox.version, item.version),
          eq(schema.feedbackScoreOutbox.lockToken, item.lockToken)
        )
      )
      .returning({ messageId: schema.feedbackScoreOutbox.messageId })
    if (acknowledged.length > 0) return "acknowledged"
    await db
      .update(schema.feedbackScoreOutbox)
      .set({
        lockedUntil: null,
        lockToken: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.feedbackScoreOutbox.messageId, item.messageId),
          eq(schema.feedbackScoreOutbox.lockToken, item.lockToken),
          gt(schema.feedbackScoreOutbox.version, item.version)
        )
      )
    return "superseded"
  },

  async fail({ item, errorCategory, now, nextAttemptAt }) {
    const [{ and, eq, gt, sql }, { db }, schema] = await Promise.all([
      import("drizzle-orm"),
      import("@/lib/db"),
      import("@/lib/db/schema"),
    ])
    const rescheduled = await db
      .update(schema.feedbackScoreOutbox)
      .set({
        attempts: sql`${schema.feedbackScoreOutbox.attempts} + 1`,
        nextAttemptAt,
        lockedUntil: null,
        lockToken: null,
        lastErrorCategory: errorCategory,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.feedbackScoreOutbox.messageId, item.messageId),
          eq(schema.feedbackScoreOutbox.version, item.version),
          eq(schema.feedbackScoreOutbox.lockToken, item.lockToken)
        )
      )
      .returning({ messageId: schema.feedbackScoreOutbox.messageId })
    if (rescheduled.length > 0) return "rescheduled"
    await db
      .update(schema.feedbackScoreOutbox)
      .set({
        lockedUntil: null,
        lockToken: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.feedbackScoreOutbox.messageId, item.messageId),
          eq(schema.feedbackScoreOutbox.lockToken, item.lockToken),
          gt(schema.feedbackScoreOutbox.version, item.version)
        )
      )
    return "superseded"
  },
}

function mirrorInput(item: FeedbackOutboxItem): FeedbackMirrorInput {
  return {
    messageId: item.messageId,
    feedback: item.value === "cleared" ? null : item.value,
    updatedAt: item.sourceUpdatedAt.toISOString(),
    version: item.version,
  }
}

export async function drainFeedbackScoreOutbox(
  input: {
    messageId?: string
    limit?: number
    leaseMs?: number
    now?: Date
    store?: FeedbackOutboxStore
    mirror?: (input: FeedbackMirrorInput) => Promise<FeedbackMirrorResult>
  } = {}
): Promise<FeedbackOutboxDrainSummary> {
  const now = input.now ?? new Date()
  const store = input.store ?? databaseFeedbackOutboxStore
  const mirror = input.mirror ?? mirrorMessageFeedback
  const items = await store.claim({
    ...(input.messageId ? { messageId: input.messageId } : {}),
    limit: Math.max(1, Math.floor(input.limit ?? 25)),
    now,
    leaseMs: Math.max(1_000, input.leaseMs ?? 30_000),
  })
  const summary: FeedbackOutboxDrainSummary = {
    claimed: items.length,
    mirrored: 0,
    superseded: 0,
    retried: 0,
    skipped: 0,
  }
  for (const item of items) {
    const result = await mirror(mirrorInput(item))
    if (result.status === "mirrored" || result.status === "queued") {
      const completion = await store.succeed(item, new Date())
      if (completion === "acknowledged") summary.mirrored += 1
      else summary.superseded += 1
      continue
    }
    const errorCategory =
      result.status === "failed"
        ? result.errorCategory
        : result.status === "skipped"
          ? result.reason
          : "unknown"
    const disposition = await store.fail({
      item,
      errorCategory,
      now: new Date(),
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(item.attempts)),
    })
    if (disposition === "superseded") summary.superseded += 1
    else if (result.status === "skipped") summary.skipped += 1
    else summary.retried += 1
  }
  return summary
}
