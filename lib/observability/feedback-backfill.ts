import type { MessageFeedback } from "@/lib/thread-chat/contracts/dto"
import {
  flushFeedbackScores,
  mirrorMessageFeedback,
  prepareFeedbackScore,
  type FeedbackMirrorInput,
  type FeedbackMirrorResult,
  type FeedbackScoreBody,
} from "@/lib/observability/feedback-score"

export type FeedbackBackfillRow = {
  id: string
  feedback: MessageFeedback | null
  updatedAt: Date | string
}

export type FeedbackBackfillSummary = {
  dryRun: boolean
  processed: number
  mirrored: number
  skipped: number
  failed: number
  flush: "not-requested" | "flushed" | "skipped" | "failed"
  samples: Array<Pick<FeedbackScoreBody, "id" | "traceId" | "value">>
}

type BackfillOptions = {
  dryRun?: boolean
  batchSize?: number
  mirror?: (input: FeedbackMirrorInput) => Promise<FeedbackMirrorResult>
  prepare?: (input: FeedbackMirrorInput) => Promise<FeedbackScoreBody>
  flush?: () => Promise<"flushed" | "skipped" | "failed">
}

function toMirrorInput(row: FeedbackBackfillRow): FeedbackMirrorInput {
  return {
    messageId: row.id,
    feedback: row.feedback,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  }
}

export async function backfillFeedbackScores(
  rows: AsyncIterable<FeedbackBackfillRow> | Iterable<FeedbackBackfillRow>,
  options: BackfillOptions = {}
): Promise<FeedbackBackfillSummary> {
  const dryRun = options.dryRun ?? true
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 100))
  const mirror =
    options.mirror ??
    ((input) => mirrorMessageFeedback(input, { flush: false }))
  const prepare = options.prepare ?? prepareFeedbackScore
  const flush = options.flush ?? flushFeedbackScores
  const summary: FeedbackBackfillSummary = {
    dryRun,
    processed: 0,
    mirrored: 0,
    skipped: 0,
    failed: 0,
    flush: "not-requested",
    samples: [],
  }
  let batch: FeedbackBackfillRow[] = []

  const processBatch = async () => {
    for (const row of batch) {
      const input = toMirrorInput(row)
      summary.processed += 1
      if (dryRun) {
        const score = await prepare(input)
        if (summary.samples.length < 5) {
          summary.samples.push({
            id: score.id,
            traceId: score.traceId,
            value: score.value,
          })
        }
        continue
      }

      const result = await mirror(input)
      if (result.status === "failed") summary.failed += 1
      else if (result.status === "skipped") summary.skipped += 1
      else summary.mirrored += 1
    }
    batch = []
  }

  for await (const row of rows) {
    batch.push(row)
    if (batch.length >= batchSize) await processBatch()
  }
  if (batch.length > 0) await processBatch()

  if (!dryRun && summary.mirrored > 0) summary.flush = await flush()
  return summary
}
