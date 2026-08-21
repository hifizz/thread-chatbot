import { readFile } from "node:fs/promises"

import { config } from "dotenv"
import postgres from "postgres"

import {
  approvedConversationResetSchema,
  assertApprovedConversationResetContext,
  conversationBackupVerificationSchema,
  type ApprovedConversationResetCounts,
} from "../lib/thread-chat/cutover/approved-conversation-reset.ts"
import { resolveConversationAuthority } from "../lib/thread-chat/cutover/conversation-authority.ts"
import { evaluateConversationCutoverDrain } from "../lib/thread-chat/cutover/conversation-drain.ts"
import {
  assertConversationCutoverManifestDisposition,
  assertConversationCutoverManifestReady,
  conversationCutoverManifestSchema,
} from "../lib/thread-chat/cutover/conversation-cutover-manifest.ts"

config({ path: ".env.local" })

const execute = process.argv.includes("--execute")
const rollback = process.argv.includes("--test-rollback")
if (execute === rollback)
  throw new Error("必须且只能指定 --execute 或 --test-rollback")

function flagValue(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith("--")) throw new Error(`必须提供 ${name}`)
  return value
}

const approvalPath = flagValue("--approval-file")
const backupVerificationPath = flagValue("--backup-verification-file")
const manifestPath = flagValue("--manifest-file")
const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2")
const parsedDatabaseUrl = new URL(databaseUrl)
const sql = postgres(databaseUrl, { max: 1, prepare: false })

async function readApprovalFiles() {
  return {
    approval: approvedConversationResetSchema.parse(
      JSON.parse(await readFile(approvalPath, "utf8"))
    ),
    backup: conversationBackupVerificationSchema.parse(
      JSON.parse(await readFile(backupVerificationPath, "utf8"))
    ),
  }
}

async function assertDrained(tx: postgres.TransactionSql): Promise<void> {
  const [counts] = await tx<
    readonly {
      legacy_active: number
      legacy_billing: number
      canonical_active: number
      canonical_billing: number
      outbox_pending: number
    }[]
  >`SELECT
      (SELECT count(*)::int FROM thread_chat.branch_generations WHERE status IN ('running', 'stop_requested')) AS legacy_active,
      (SELECT count(*)::int FROM thread_chat.branch_generations WHERE billing_status = 'pending') AS legacy_billing,
      (SELECT count(*)::int FROM thread_chat.conversation_generations WHERE status IN ('running', 'stop_requested')) AS canonical_active,
      (SELECT count(*)::int FROM thread_chat.conversation_generations WHERE billing_status = 'pending') AS canonical_billing,
      (SELECT count(*)::int FROM thread_chat.conversation_outbox_events WHERE status <> 'dispatched') AS outbox_pending`
  if (!counts) throw new Error("无法读取 cutover drain 状态")
  const drain = evaluateConversationCutoverDrain({
    legacyActiveGenerations: counts.legacy_active,
    legacyPendingBilling: counts.legacy_billing,
    canonicalActiveGenerations: counts.canonical_active,
    canonicalPendingBilling: counts.canonical_billing,
    canonicalPendingOutbox: counts.outbox_pending,
  })
  if (!drain.ready)
    throw new Error(`Cutover drain 未清零：${JSON.stringify(drain.blockers)}`)
}

async function resolveScope(
  tx: postgres.TransactionSql,
  scope: "all" | readonly string[]
): Promise<string[]> {
  const rows =
    scope === "all"
      ? await tx<readonly { id: string }[]>`
          SELECT id FROM thread_chat.branch_trees ORDER BY id`
      : await tx<readonly { id: string }[]>`
          SELECT id FROM thread_chat.branch_trees
          WHERE id = ANY(${tx.array([...scope], 25)}) ORDER BY id`
  if (scope !== "all" && rows.length !== new Set(scope).size)
    throw new Error("重置审批 scope 中包含不存在或重复的 legacy tree")
  return rows.map((entry) => entry.id)
}

async function loadResetFacts(
  tx: postgres.TransactionSql,
  treeIds: readonly string[]
): Promise<{
  counts: ApprovedConversationResetCounts
  canonicalIds: string[]
  allMappedIds: string[]
  generationIds: string[]
  projectIds: string[]
  workspaceIds: string[]
}> {
  if (treeIds.length === 0)
    return {
      counts: {
        legacyTrees: 0,
        legacyGenerations: 0,
        legacyFeedback: 0,
        mappings: 0,
        canonicalConversations: 0,
        canonicalGenerations: 0,
        canonicalFeedback: 0,
        canonicalArtifacts: 0,
        commandRecords: 0,
        outboxEvents: 0,
        preservedUsageRecords: 0,
      },
      canonicalIds: [],
      allMappedIds: [],
      generationIds: [],
      projectIds: [],
      workspaceIds: [],
    }

  const mappings = await tx<
    readonly { entity_type: string; canonical_id: string; local_id: string }[]
  >`SELECT entity_type, canonical_id, local_id
    FROM thread_chat.legacy_conversation_entity_mappings
    WHERE legacy_tree_id = ANY(${tx.array([...treeIds], 25)})
    ORDER BY legacy_tree_id, entity_type, local_id`
  const canonicalIds = mappings
    .filter((entry) => entry.entity_type === "conversation")
    .map((entry) => entry.canonical_id)
  const allMappedIds = mappings.map((entry) => entry.canonical_id)
  const generationIds = mappings
    .filter((entry) => entry.entity_type === "generation")
    .flatMap((entry) => [entry.local_id, entry.canonical_id])

  const [row] = await tx<
    readonly (ApprovedConversationResetCounts & {
      project_ids: string[] | null
      workspace_ids: string[] | null
    })[]
  >`SELECT
      (SELECT count(*)::int FROM thread_chat.branch_trees WHERE id = ANY(${tx.array([...treeIds], 25)})) AS "legacyTrees",
      (SELECT count(*)::int FROM thread_chat.branch_generations WHERE tree_id = ANY(${tx.array([...treeIds], 25)})) AS "legacyGenerations",
      (SELECT count(*)::int FROM thread_chat.branch_message_feedback WHERE tree_id = ANY(${tx.array([...treeIds], 25)})) AS "legacyFeedback",
      ${mappings.length}::int AS mappings,
      (SELECT count(*)::int FROM thread_chat.conversations WHERE id = ANY(${tx.array(canonicalIds, 25)})) AS "canonicalConversations",
      (SELECT count(*)::int FROM thread_chat.conversation_generations WHERE conversation_id = ANY(${tx.array(canonicalIds, 25)})) AS "canonicalGenerations",
      (SELECT count(*)::int FROM thread_chat.conversation_message_feedback WHERE conversation_id = ANY(${tx.array(canonicalIds, 25)})) AS "canonicalFeedback",
      (SELECT count(*)::int FROM thread_chat.conversation_artifacts WHERE conversation_id = ANY(${tx.array(canonicalIds, 25)})) AS "canonicalArtifacts",
      (SELECT count(*)::int FROM thread_chat.conversation_command_records WHERE scope_id = ANY(${tx.array(allMappedIds, 25)})) AS "commandRecords",
      (SELECT count(*)::int FROM thread_chat.conversation_outbox_events WHERE aggregate_id = ANY(${tx.array(allMappedIds, 25)})) AS "outboxEvents",
      (SELECT count(*)::int FROM thread_chat.usage_records WHERE app_generation_id = ANY(${tx.array(generationIds, 25)})) AS "preservedUsageRecords",
      (SELECT array_agg(DISTINCT project_id) FROM thread_chat.conversations WHERE id = ANY(${tx.array(canonicalIds, 25)})) AS project_ids,
      (SELECT array_agg(DISTINCT p.workspace_id) FROM thread_chat.conversations c JOIN thread_chat.projects p ON p.id = c.project_id WHERE c.id = ANY(${tx.array(canonicalIds, 25)})) AS workspace_ids`
  if (!row) throw new Error("无法读取受批准重置的目标计数")
  const { project_ids, workspace_ids, ...counts } = row
  return {
    counts,
    canonicalIds,
    allMappedIds,
    generationIds,
    projectIds: project_ids ?? [],
    workspaceIds: workspace_ids ?? [],
  }
}

async function deleteApprovedScope(
  tx: postgres.TransactionSql,
  input: Awaited<ReturnType<typeof loadResetFacts>>,
  treeIds: readonly string[]
): Promise<void> {
  if (treeIds.length === 0) return
  // usage_records 是不可随会话重置消失的财务账本，刻意不删除。
  await tx`DELETE FROM thread_chat.conversation_command_records
    WHERE scope_id = ANY(${tx.array(input.allMappedIds, 25)})`
  await tx`DELETE FROM thread_chat.conversation_outbox_events
    WHERE aggregate_id = ANY(${tx.array(input.allMappedIds, 25)})`
  // Generation 的跨 Project/Conversation 复合外键刻意不是 cascade；先显式删除，
  // 让 reset 顺序与正常领域删除的审计边界一致。usage_records 没有 FK，继续保留。
  await tx`DELETE FROM thread_chat.conversation_generations
    WHERE conversation_id = ANY(${tx.array(input.canonicalIds, 25)})`
  await tx`DELETE FROM thread_chat.conversations
    WHERE id = ANY(${tx.array(input.canonicalIds, 25)})`
  await tx`DELETE FROM thread_chat.legacy_conversation_entity_mappings
    WHERE legacy_tree_id = ANY(${tx.array([...treeIds], 25)})`
  await tx`DELETE FROM thread_chat.branch_trees
    WHERE id = ANY(${tx.array([...treeIds], 25)})`
  if (input.projectIds.length > 0)
    await tx`DELETE FROM thread_chat.projects p
      WHERE p.id = ANY(${tx.array(input.projectIds, 25)})
        AND p.id LIKE 'legacy-project:%'
        AND NOT EXISTS (SELECT 1 FROM thread_chat.conversations c WHERE c.project_id = p.id)`
  if (input.workspaceIds.length > 0)
    await tx`DELETE FROM thread_chat.workspaces w
      WHERE w.id = ANY(${tx.array(input.workspaceIds, 25)})
        AND w.id LIKE 'legacy-workspace:%'
        AND NOT EXISTS (SELECT 1 FROM thread_chat.projects p WHERE p.workspace_id = w.id)`
}

try {
  const { approval, backup } = await readApprovalFiles()
  const manifest = conversationCutoverManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8"))
  )
  const authority = resolveConversationAuthority()
  if (
    authority.authority !== "legacy" ||
    authority.maintenanceMode !== "read-only"
  )
    throw new Error("受批准重置只允许在 legacy + read-only 维护窗口执行")
  assertConversationCutoverManifestReady({
    manifest,
    environment: process.env.CONVERSATION_CUTOVER_ENVIRONMENT ?? "",
    databaseHost: parsedDatabaseUrl.hostname,
    databaseName: parsedDatabaseUrl.pathname.slice(1),
  })
  assertConversationCutoverManifestDisposition({
    manifest,
    mode: "approved-reset",
    approvalId: approval.approvalId,
    backupId: approval.backupId,
    legacyTreeIds: approval.scope.legacyTreeIds,
  })

  class RollbackProbe extends Error {}
  let output: unknown
  try {
    await sql.begin(async (tx) => {
      await tx`LOCK TABLE thread_chat.branch_trees,
        thread_chat.branch_generations,
        thread_chat.branch_message_feedback,
        thread_chat.conversations,
        thread_chat.conversation_generations,
        thread_chat.conversation_command_records,
        thread_chat.conversation_outbox_events,
        thread_chat.legacy_conversation_entity_mappings
        IN SHARE ROW EXCLUSIVE MODE`
      await assertDrained(tx)
      const treeIds = await resolveScope(tx, approval.scope.legacyTreeIds)
      const facts = await loadResetFacts(tx, treeIds)
      assertApprovedConversationResetContext({
        approval,
        backup,
        environment: process.env.CONVERSATION_CUTOVER_ENVIRONMENT,
        databaseHost: parsedDatabaseUrl.hostname,
        databaseName: parsedDatabaseUrl.pathname.slice(1),
        approvalId: process.env.CONVERSATION_CUTOVER_APPROVAL_ID,
        backupId: process.env.CONVERSATION_CUTOVER_BACKUP_ID,
        resetEnabled: process.env.CONVERSATION_APPROVED_RESET_ENABLED,
        actualCounts: facts.counts,
      })
      await deleteApprovedScope(tx, facts, treeIds)
      const after = await loadResetFacts(tx, treeIds)
      const nonzero = Object.entries(after.counts).filter(
        ([key, value]) => key !== "preservedUsageRecords" && value !== 0
      )
      if (nonzero.length > 0)
        throw new Error(`重置后仍有目标实体：${JSON.stringify(nonzero)}`)
      output = {
        mode: rollback ? "test-rollback" : "execute",
        environment: approval.environment,
        approvalId: approval.approvalId,
        backupId: approval.backupId,
        restoreTestId: backup.restoreTestId,
        treeIds,
        deleted: facts.counts,
        preservedUsageRecords: facts.counts.preservedUsageRecords,
        committed: execute && !rollback,
      }
      if (rollback) throw new RollbackProbe("测试事务按设计回滚")
    })
  } catch (error) {
    if (!(error instanceof RollbackProbe)) throw error
  }
  console.log(JSON.stringify(output, null, 2))
} finally {
  await sql.end()
}
