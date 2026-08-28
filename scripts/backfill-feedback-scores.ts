import { config } from "dotenv"
import postgres from "postgres"
import { backfillFeedbackScores } from "@/lib/observability/feedback-backfill"

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

const execute = process.argv.includes("--execute")
const batchSize = integerArgument("batch-size", 100)
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: process.env.DB_PREPARE === "true",
})

async function* feedbackRows() {
  let cursor = ""
  while (true) {
    const rows = await sql<
      Array<{ id: string; feedback: "up" | "down"; updated_at: Date }>
    >`
      select id, feedback, updated_at
      from thread_chat.messages
      where role = 'assistant'
        and feedback is not null
        and id > ${cursor}
      order by id
      limit ${batchSize}
    `
    if (rows.length === 0) return
    for (const row of rows) {
      yield {
        id: row.id,
        feedback: row.feedback,
        updatedAt: row.updated_at,
      }
    }
    cursor = rows.at(-1)!.id
  }
}

try {
  const summary = await backfillFeedbackScores(feedbackRows(), {
    dryRun: !execute,
    batchSize,
  })
  console.log(JSON.stringify(summary, null, 2))
  if (!execute) {
    console.log(
      "Dry run only. Re-run with --execute after reviewing the count and IDs."
    )
  }
  if (summary.failed > 0 || summary.flush === "failed") process.exitCode = 1
} finally {
  await sql.end()
}
