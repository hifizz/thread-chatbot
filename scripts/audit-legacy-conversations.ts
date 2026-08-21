import { config } from "dotenv"
import postgres from "postgres"

import { auditLegacyConversation } from "../lib/thread-chat/legacy/audit-thread-tree.ts"

config({ path: ".env.local" })

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2")
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  const trees = await sql<
    readonly { id: string; user_id: string | null; state: unknown }[]
  >`SELECT id, user_id, state FROM thread_chat.branch_trees ORDER BY id`
  const generations = await sql<
    readonly {
      id: string
      user_id: string
      tree_id: string
      thread_id: string
      user_message_id: string
      assistant_message_id: string
      intent_present: boolean
    }[]
  >`SELECT id, user_id, tree_id, thread_id, user_message_id, assistant_message_id,
      (turn_snapshot ? 'intent') AS intent_present
    FROM thread_chat.branch_generations ORDER BY tree_id, id`
  const feedback = await sql<
    readonly {
      user_id: string
      tree_id: string
      thread_id: string
      message_id: string
    }[]
  >`SELECT user_id, tree_id, thread_id, message_id FROM thread_chat.branch_message_feedback ORDER BY tree_id, thread_id, message_id`

  const reports = trees.map((tree) =>
    auditLegacyConversation({
      treeId: tree.id,
      ownerUserId: tree.user_id,
      state: tree.state,
      generations: generations
        .filter((generation) => generation.tree_id === tree.id)
        .map((generation) => ({
          id: generation.id,
          ownerUserId: generation.user_id,
          intentPresent: generation.intent_present,
          threadId: generation.thread_id,
          userMessageId: generation.user_message_id,
          assistantMessageId: generation.assistant_message_id,
        })),
      feedback: feedback
        .filter((entry) => entry.tree_id === tree.id)
        .map((entry) => ({
          ownerUserId: entry.user_id,
          threadId: entry.thread_id,
          messageId: entry.message_id,
        })),
    })
  )
  const issueCounts = Object.fromEntries(
    [
      ...new Set(
        reports.flatMap((report) => report.issues.map((entry) => entry.code))
      ),
    ]
      .sort()
      .map((code) => [
        code,
        reports.reduce(
          (count, report) =>
            count + report.issues.filter((entry) => entry.code === code).length,
          0
        ),
      ])
  )
  const output = {
    mode: "dry-run",
    readOnly: true,
    summary: {
      totalTrees: reports.length,
      ownedTrees: reports.filter((report) => report.owner === "owned").length,
      unownedTrees: reports.filter((report) => report.owner === "unowned")
        .length,
      migratable: reports.filter(
        (report) => report.disposition === "migratable"
      ).length,
      needsRepair: reports.filter(
        (report) => report.disposition === "needs_repair"
      ).length,
      rejected: reports.filter((report) => report.disposition === "rejected")
        .length,
      entities: {
        threads: reports.reduce(
          (count, report) => count + report.counts.threads,
          0
        ),
        turns: reports.reduce(
          (count, report) => count + report.counts.turns,
          0
        ),
        messages: reports.reduce(
          (count, report) => count + report.counts.messages,
          0
        ),
        forks: reports.reduce(
          (count, report) => count + report.counts.forks,
          0
        ),
        artifacts: reports.reduce(
          (count, report) => count + report.counts.artifacts,
          0
        ),
        generations: reports.reduce(
          (count, report) => count + report.counts.generations,
          0
        ),
        feedback: reports.reduce(
          (count, report) => count + report.counts.feedback,
          0
        ),
      },
      issueCounts,
    },
    ...(process.argv.includes("--summary-only") ? {} : { reports }),
  }
  console.log(JSON.stringify(output, null, 2))
} finally {
  await sql.end()
}
