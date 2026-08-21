import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { config } from "dotenv"
import postgres from "postgres"
import { z } from "zod"

import { generationResultV1Schema } from "../lib/thread-chat/contracts/generation-result.ts"
import { threadChatGenerationIntentSchema } from "../lib/thread-chat/contracts/generation-intent.ts"
import { parseThreadTreeState } from "../lib/thread-chat/domain/message-graph.ts"
import type { MessageFeedback } from "../lib/thread-chat/domain/types.ts"
import { resolveConversationAuthority } from "../lib/thread-chat/cutover/conversation-authority.ts"
import {
  buildLegacyConversationImportPlan,
  type LegacyConversationImportPlan,
} from "../lib/thread-chat/cutover/legacy-conversation-import.ts"
import { evaluateConversationCutoverDrain } from "../lib/thread-chat/cutover/conversation-drain.ts"

config({ path: ".env.local" })

const approvalSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal("deterministic-import"),
    environment: z.string().trim().min(1),
    database: z
      .object({
        host: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    scope: z
      .object({
        legacyTreeIds: z.union([z.literal("all"), z.array(z.string().min(1))]),
      })
      .strict(),
    backupId: z.string().trim().min(1),
    approvalId: z.string().trim().min(1),
    approvedBy: z.string().trim().min(1),
    approvedAt: z.string().datetime(),
    approvedRepairs: z.array(z.literal("missing-generation-intent-as-send")),
  })
  .strict()

const args = new Set(process.argv.slice(2))
const execute = args.has("--execute")
const rollback = args.has("--test-rollback")
const approvalFlag = process.argv.indexOf("--approval-file")
const approvalPath =
  approvalFlag >= 0 ? process.argv[approvalFlag + 1] : undefined

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const databaseUrl = rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2")
const parsedDatabaseUrl = new URL(databaseUrl)
const sql = postgres(databaseUrl, { max: 1, prepare: false })

function hashIds(values: readonly string[]): string {
  return createHash("sha256")
    .update([...values].sort().join("\n"))
    .digest("hex")
}

function sqlJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue
}

function planIds(plan: LegacyConversationImportPlan): string[] {
  return [
    plan.snapshot.conversation.id,
    ...Object.keys(plan.snapshot.threads),
    ...Object.keys(plan.snapshot.turns),
    ...Object.keys(plan.snapshot.messages),
    ...Object.keys(plan.snapshot.threadForks),
    ...plan.generations.map((entry) => entry.id),
    ...plan.artifacts.map((entry) => entry.id),
    ...plan.feedback.map((entry) => `${entry.userId}:${entry.messageId}`),
  ]
}

async function loadPlans(treeScope: "all" | readonly string[]) {
  const trees = await sql<
    readonly {
      id: string
      user_id: string | null
      title: string | null
      custom_title: string | null
      state: unknown
    }[]
  >`SELECT id, user_id, title, custom_title, state FROM thread_chat.branch_trees ORDER BY id`
  const selected =
    treeScope === "all"
      ? trees
      : trees.filter((tree) => treeScope.includes(tree.id))
  if (treeScope !== "all" && selected.length !== new Set(treeScope).size)
    throw new Error("审批 scope 中包含不存在的 legacy tree")

  const generations = await sql<readonly Record<string, unknown>[]>`
    SELECT * FROM thread_chat.branch_generations ORDER BY tree_id, id
  `
  const feedback = await sql<readonly Record<string, unknown>[]>`
    SELECT * FROM thread_chat.branch_message_feedback ORDER BY tree_id, thread_id, message_id
  `

  const repairs: {
    code: "missing-generation-intent-as-send"
    treeId: string
    generationId: string
  }[] = []
  const plans = selected.map((tree) => {
    if (!tree.user_id) throw new Error(`Legacy tree ${tree.id} 没有 owner`)
    return buildLegacyConversationImportPlan({
      treeId: tree.id,
      ownerUserId: tree.user_id,
      title: tree.title,
      customTitle: tree.custom_title,
      state: parseThreadTreeState(tree.state),
      generations: generations
        .filter((entry) => entry.tree_id === tree.id)
        .map((entry) => ({
          id: z.string().parse(entry.id),
          userId: z.string().parse(entry.user_id),
          threadId: z.string().parse(entry.thread_id),
          userMessageId: z.string().parse(entry.user_message_id),
          assistantMessageId: z.string().parse(entry.assistant_message_id),
          attempt: z.number().int().positive().parse(entry.attempt),
          isCurrent: z.boolean().parse(entry.is_current),
          status: z
            .enum([
              "running",
              "stop_requested",
              "completed",
              "stopped",
              "failed",
              "superseded",
            ])
            .parse(entry.status),
          modelId: z.string().parse(entry.model_id),
          intent: (() => {
            const parsed = threadChatGenerationIntentSchema.safeParse(
              (entry.turn_snapshot as Record<string, unknown>)?.intent
            )
            if (parsed.success) return parsed.data
            repairs.push({
              code: "missing-generation-intent-as-send",
              treeId: tree.id,
              generationId: z.string().parse(entry.id),
            })
            // 早期 sidecar 没有 intent。终态导入只保留执行来源；用最弱的 send
            // 语义修复，不据此重新执行模型，也不猜测 edit/regenerate 来源。
            return { kind: "persisted-turn" as const }
          })(),
          result: entry.result
            ? generationResultV1Schema.parse(entry.result)
            : null,
          billingStatus: z
            .enum(["pending", "settled", "usage_unavailable", "not_billable"])
            .parse(entry.billing_status),
          heartbeatAt: z.date().parse(entry.heartbeat_at),
          stopRequestedAt: entry.stop_requested_at
            ? z.date().parse(entry.stop_requested_at)
            : null,
          finishedAt: entry.finished_at
            ? z.date().parse(entry.finished_at)
            : null,
          createdAt: z.date().parse(entry.created_at),
          updatedAt: z.date().parse(entry.updated_at),
          error: entry.error ? z.string().parse(entry.error) : null,
        })),
      feedback: feedback
        .filter((entry) => entry.tree_id === tree.id)
        .map((entry) => ({
          userId: z.string().parse(entry.user_id),
          threadId: z.string().parse(entry.thread_id),
          messageId: z.string().parse(entry.message_id),
          feedback: z
            .enum(["positive", "negative"])
            .parse(entry.feedback) as MessageFeedback,
          createdAt: z.date().parse(entry.created_at),
          updatedAt: z.date().parse(entry.updated_at),
        })),
    })
  })
  return { plans, repairs }
}

async function insertPlan(
  tx: postgres.TransactionSql,
  plan: LegacyConversationImportPlan
) {
  const snapshot = plan.snapshot
  const [claim] = await tx<
    readonly { conversations: number; mappings: number }[]
  >`SELECT
      (SELECT count(*)::int FROM thread_chat.conversations WHERE id = ${snapshot.conversation.id}) AS conversations,
      (SELECT count(*)::int FROM thread_chat.legacy_conversation_entity_mappings WHERE legacy_tree_id = ${plan.legacyTreeId}) AS mappings`
  if (!claim) throw new Error("无法读取导入身份占用状态")
  if (claim.conversations > 0 && claim.mappings === 0)
    throw new Error(
      `Canonical Conversation ${snapshot.conversation.id} 已存在但没有 legacy 映射，拒绝覆盖`
    )
  if (claim.conversations === 0 && claim.mappings > 0)
    throw new Error(
      `Legacy tree ${plan.legacyTreeId} 存在映射但 Conversation 缺失，拒绝猜测恢复`
    )
  await tx`SET CONSTRAINTS ALL DEFERRED`
  await tx`INSERT INTO thread_chat.workspaces (id, revision, lifecycle)
    VALUES (${snapshot.project.workspaceId}, 0, 'active') ON CONFLICT (id) DO NOTHING`
  await tx`INSERT INTO thread_chat.workspace_members (workspace_id, user_id, role)
    VALUES (${snapshot.project.workspaceId}, ${plan.ownerUserId}, 'owner') ON CONFLICT DO NOTHING`
  await tx`INSERT INTO thread_chat.projects (id, workspace_id, title, revision, lifecycle)
    VALUES (${snapshot.project.id}, ${snapshot.project.workspaceId}, ${snapshot.project.title}, 0, 'active') ON CONFLICT (id) DO NOTHING`
  await tx`INSERT INTO thread_chat.conversations
    (id, project_id, root_thread_id, auto_title, custom_title, revision, lifecycle)
    VALUES (${snapshot.conversation.id}, ${snapshot.conversation.projectId}, ${snapshot.conversation.rootThreadId}, ${snapshot.conversation.autoTitle}, ${snapshot.conversation.customTitle}, 0, 'active')
    ON CONFLICT (id) DO NOTHING`

  for (const thread of Object.values(snapshot.threads))
    await tx`INSERT INTO thread_chat.conversation_threads
      (id, conversation_id, model_id, local_title, revision, lifecycle)
      VALUES (${thread.id}, ${thread.conversationId}, ${thread.modelId}, ${thread.localTitle}, ${thread.revision}, ${thread.lifecycle})
      ON CONFLICT (id) DO NOTHING`
  for (const turn of Object.values(snapshot.turns))
    await tx`INSERT INTO thread_chat.conversation_turns
      (id, thread_id, position, active_user_message_id, active_assistant_message_id, revision)
      VALUES (${turn.id}, ${turn.threadId}, ${turn.position}, ${turn.activeUserMessageId}, ${turn.activeAssistantMessageId}, ${turn.revision})
      ON CONFLICT (id) DO NOTHING`
  for (const message of Object.values(snapshot.messages))
    await tx`INSERT INTO thread_chat.conversation_messages
      (id, thread_id, turn_id, role, content, content_state, variant_of_message_id, created_at)
      VALUES (${message.id}, ${message.threadId}, ${message.turnId}, ${message.role}, ${tx.json(sqlJson(message.content))}, ${message.contentState}, ${message.variantOfMessageId ?? null}, ${new Date(message.createdAt)})
      ON CONFLICT (id) DO NOTHING`
  for (const fork of Object.values(snapshot.threadForks))
    await tx`INSERT INTO thread_chat.thread_forks
      (id, conversation_id, parent_thread_id, source_message_id, child_thread_id, anchor, created_by, created_at)
      VALUES (${fork.id}, ${fork.conversationId}, ${fork.parentThreadId}, ${fork.sourceMessageId}, ${fork.childThreadId}, ${fork.anchor ? tx.json(sqlJson(fork.anchor)) : null}, ${fork.createdBy}, ${new Date(fork.createdAt)})
      ON CONFLICT (id) DO NOTHING`
  for (const artifact of plan.artifacts)
    await tx`INSERT INTO thread_chat.conversation_artifacts
      (id, conversation_id, source_thread_id, source_message_id, title, kind, lang, content)
      VALUES (${artifact.id}, ${artifact.conversationId}, ${artifact.sourceThreadId}, ${artifact.sourceMessageId}, ${artifact.title}, ${artifact.kind}, ${artifact.lang}, ${artifact.content})
      ON CONFLICT (id) DO NOTHING`
  for (const generation of plan.generations)
    await tx`INSERT INTO thread_chat.conversation_generations
      (id, owner_id, workspace_id, project_id, conversation_id, thread_id, turn_id, input_message_id, output_message_id, intent, request_hash, idempotency_key, model_id, attempt, is_current, status, content_state, checkpoint_version, checkpoint, known_usage, usage_completeness, billing_status, paid_call_started, lease_owner, lease_version, heartbeat_at, stop_requested_at, started_at, finished_at, error_code, created_at, updated_at)
      VALUES (${generation.id}, ${generation.ownerId}, ${generation.workspaceId}, ${generation.projectId}, ${generation.conversationId}, ${generation.threadId}, ${generation.turnId}, ${generation.inputMessageId}, ${generation.outputMessageId}, ${tx.json(generation.intent)}, ${generation.requestHash}, ${generation.idempotencyKey}, ${generation.modelId}, ${generation.attempt}, ${generation.isCurrent}, ${generation.status}, ${generation.contentState}, ${generation.checkpointVersion}, ${tx.json(generation.checkpoint)}, ${generation.knownUsage ? tx.json(generation.knownUsage) : null}, ${generation.usageCompleteness}, ${generation.billingStatus}, ${generation.paidCallStarted}, ${null}, ${0}, ${generation.heartbeatAt}, ${generation.stopRequestedAt}, ${generation.startedAt}, ${generation.finishedAt}, ${generation.errorCode}, ${generation.createdAt}, ${generation.updatedAt})
      ON CONFLICT (id) DO NOTHING`
  for (const entry of plan.feedback)
    await tx`INSERT INTO thread_chat.conversation_message_feedback
      (user_id, conversation_id, thread_id, message_id, feedback, created_at, updated_at)
      VALUES (${entry.userId}, ${entry.conversationId}, ${entry.threadId}, ${entry.messageId}, ${entry.feedback}, ${entry.createdAt}, ${entry.updatedAt})
      ON CONFLICT (user_id, conversation_id, message_id) DO NOTHING`
  for (const mapping of plan.mappings)
    await tx`INSERT INTO thread_chat.legacy_conversation_entity_mappings
      (legacy_tree_id, entity_type, local_id, canonical_id)
      VALUES (${mapping.legacyTreeId}, ${mapping.entityType}, ${mapping.localId}, ${mapping.canonicalId})
      ON CONFLICT (legacy_tree_id, entity_type, local_id) DO NOTHING`
}

async function verifyPlan(
  tx: postgres.TransactionSql,
  plan: LegacyConversationImportPlan
) {
  const [counts] = await tx<
    readonly {
      threads: number
      turns: number
      messages: number
      forks: number
      generations: number
      artifacts: number
      feedback: number
      mappings: number
    }[]
  >`SELECT
      (SELECT count(*)::int FROM thread_chat.conversation_threads WHERE conversation_id = ${plan.snapshot.conversation.id}) AS threads,
      (SELECT count(*)::int FROM thread_chat.conversation_turns t JOIN thread_chat.conversation_threads th ON th.id=t.thread_id WHERE th.conversation_id = ${plan.snapshot.conversation.id}) AS turns,
      (SELECT count(*)::int FROM thread_chat.conversation_messages m JOIN thread_chat.conversation_threads th ON th.id=m.thread_id WHERE th.conversation_id = ${plan.snapshot.conversation.id}) AS messages,
      (SELECT count(*)::int FROM thread_chat.thread_forks WHERE conversation_id = ${plan.snapshot.conversation.id}) AS forks,
      (SELECT count(*)::int FROM thread_chat.conversation_generations WHERE conversation_id = ${plan.snapshot.conversation.id}) AS generations,
      (SELECT count(*)::int FROM thread_chat.conversation_artifacts WHERE conversation_id = ${plan.snapshot.conversation.id}) AS artifacts,
      (SELECT count(*)::int FROM thread_chat.conversation_message_feedback WHERE conversation_id = ${plan.snapshot.conversation.id}) AS feedback,
      (SELECT count(*)::int FROM thread_chat.legacy_conversation_entity_mappings WHERE legacy_tree_id = ${plan.legacyTreeId}) AS mappings`
  if (!counts) throw new Error("导入后计数读取失败")
  const expected = {
    threads: Object.keys(plan.snapshot.threads).length,
    turns: Object.keys(plan.snapshot.turns).length,
    messages: Object.keys(plan.snapshot.messages).length,
    forks: Object.keys(plan.snapshot.threadForks).length,
    generations: plan.generations.length,
    artifacts: plan.artifacts.length,
    feedback: plan.feedback.length,
    mappings: plan.mappings.length,
  }
  if (JSON.stringify(counts) !== JSON.stringify(expected))
    throw new Error(
      `导入后计数不一致：expected=${JSON.stringify(expected)} actual=${JSON.stringify(counts)}`
    )
  const targetMappings = await tx<readonly { canonical_id: string }[]>`
    SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings
    WHERE legacy_tree_id = ${plan.legacyTreeId} ORDER BY canonical_id`
  const mappingHash = hashIds(targetMappings.map((entry) => entry.canonical_id))
  const expectedMappingHash = hashIds(
    plan.mappings.map((entry) => entry.canonicalId)
  )
  if (mappingHash !== expectedMappingHash)
    throw new Error("导入后 ID 映射摘要不一致")
  return { counts, mappingHash, planEntityHash: hashIds(planIds(plan)) }
}

try {
  let approval: z.infer<typeof approvalSchema> | null = null
  if (execute || rollback) {
    if (!approvalPath) throw new Error("执行写入必须提供 --approval-file")
    approval = approvalSchema.parse(
      JSON.parse(await readFile(approvalPath, "utf8"))
    )
    const authority = resolveConversationAuthority()
    if (
      authority.authority !== "legacy" ||
      authority.maintenanceMode !== "read-only"
    )
      throw new Error("导入只允许在 legacy + read-only 维护窗口执行")
    if (process.env.CONVERSATION_CUTOVER_APPROVAL_ID !== approval.approvalId)
      throw new Error("CONVERSATION_CUTOVER_APPROVAL_ID 与审批文件不匹配")
    if (
      parsedDatabaseUrl.hostname !== approval.database.host ||
      parsedDatabaseUrl.pathname.slice(1) !== approval.database.name
    )
      throw new Error("当前数据库与审批文件目标不匹配")
    const [drainCounts] = await sql<
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
    if (!drainCounts) throw new Error("无法读取 cutover drain 状态")
    const drain = evaluateConversationCutoverDrain({
      legacyActiveGenerations: drainCounts.legacy_active,
      legacyPendingBilling: drainCounts.legacy_billing,
      canonicalActiveGenerations: drainCounts.canonical_active,
      canonicalPendingBilling: drainCounts.canonical_billing,
      canonicalPendingOutbox: drainCounts.outbox_pending,
    })
    if (!drain.ready)
      throw new Error(`Cutover drain 未清零：${JSON.stringify(drain.blockers)}`)
  }

  const loaded = await loadPlans(approval?.scope.legacyTreeIds ?? "all")
  const { plans, repairs } = loaded
  if (
    (execute || rollback) &&
    repairs.some((repair) => !approval?.approvedRepairs.includes(repair.code))
  )
    throw new Error("审批文件未批准 dry-run 发现的 Generation intent 修复")
  if (!execute && !rollback) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          readOnly: true,
          conversations: plans.length,
          entities: plans.reduce(
            (total, plan) => total + planIds(plan).length,
            0
          ),
          planHash: hashIds(plans.flatMap(planIds)),
          repairs,
          reports: plans.map((plan) => ({
            legacyTreeId: plan.legacyTreeId,
            conversationId: plan.snapshot.conversation.id,
            mappings: plan.mappings.length,
            entityHash: hashIds(planIds(plan)),
          })),
        },
        null,
        2
      )
    )
  } else {
    class RollbackProbe extends Error {}
    const verified: unknown[] = []
    try {
      await sql.begin(async (tx) => {
        for (const plan of plans) {
          await insertPlan(tx, plan)
          verified.push(await verifyPlan(tx, plan))
        }
        // 回滚演练在同一事务重复导入，验证 upsert/映射账本真正幂等。
        if (rollback)
          for (const plan of plans) {
            await insertPlan(tx, plan)
            await verifyPlan(tx, plan)
          }
        if (rollback) throw new RollbackProbe("测试事务按设计回滚")
      })
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error
    }
    console.log(
      JSON.stringify(
        {
          mode: rollback ? "test-rollback" : "execute",
          approvalId: approval?.approvalId,
          backupId: approval?.backupId,
          conversations: plans.length,
          repairs,
          verified,
          committed: execute && !rollback,
        },
        null,
        2
      )
    )
  }
} finally {
  await sql.end()
}
