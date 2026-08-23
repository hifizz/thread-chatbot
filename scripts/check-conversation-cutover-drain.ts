import { config } from "dotenv"
import postgres from "postgres"

import { evaluateConversationCutoverDrain } from "../lib/thread-chat/cutover/conversation-drain.ts"

config({ path: ".env.local" })

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2")
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  const [row] = await sql<
    readonly {
      canonical_active_generations: number
      canonical_pending_billing: number
      canonical_pending_outbox: number
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM thread_chat.conversation_generations
        WHERE status IN ('running', 'stop_requested')) AS canonical_active_generations,
      (SELECT count(*)::int FROM thread_chat.conversation_generations
        WHERE billing_status = 'pending') AS canonical_pending_billing,
      (SELECT count(*)::int FROM thread_chat.conversation_outbox_events
        WHERE status <> 'dispatched') AS canonical_pending_outbox
  `
  if (!row) throw new Error("无法读取 Conversation drain 状态")
  const report = evaluateConversationCutoverDrain({
    legacyActiveGenerations: 0,
    legacyPendingBilling: 0,
    canonicalActiveGenerations: row.canonical_active_generations,
    canonicalPendingBilling: row.canonical_pending_billing,
    canonicalPendingOutbox: row.canonical_pending_outbox,
  })
  console.log(JSON.stringify({ mode: "read-only", ...report }, null, 2))
  if (!report.ready) process.exitCode = 2
} finally {
  await sql.end()
}
