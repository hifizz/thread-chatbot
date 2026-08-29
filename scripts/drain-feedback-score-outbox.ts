import { config } from "dotenv"

config({ path: ".env.local" })

function integerArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))
  if (!value) return fallback
  const parsed = Number(value.slice(prefix.length))
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${prefix}<positive integer> is required`)
  }
  return parsed
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required")
}

const batchSize = integerArgument("batch-size", 25)
const maxBatches = integerArgument("max-batches", 100)
const totals = {
  batches: 0,
  claimed: 0,
  mirrored: 0,
  superseded: 0,
  retried: 0,
  skipped: 0,
}

const { drainFeedbackScoreOutbox } =
  await import("@/lib/observability/feedback-outbox")
for (let batch = 0; batch < maxBatches; batch++) {
  const result = await drainFeedbackScoreOutbox({ limit: batchSize })
  totals.batches += 1
  totals.claimed += result.claimed
  totals.mirrored += result.mirrored
  totals.superseded += result.superseded
  totals.retried += result.retried
  totals.skipped += result.skipped
  if (result.claimed < batchSize) break
}

console.log(JSON.stringify(totals, null, 2))
if (totals.retried > 0 || totals.skipped > 0) process.exitCode = 1
