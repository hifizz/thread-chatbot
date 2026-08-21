import { createHash, randomUUID } from "node:crypto"
import { readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { config } from "dotenv"
import postgres from "postgres"

config({ path: ".env.local" })

if (!process.argv.includes("--approve-local-ephemeral-databases"))
  throw new Error(
    "本地演练会创建并删除临时数据库；必须显式传入 --approve-local-ephemeral-databases。"
  )

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const sourceUrl = new URL(rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2"))
if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname))
  throw new Error("本演练只允许连接 localhost/loopback 数据库")

const runId = randomUUID().replaceAll("-", "").slice(0, 12)
const databasePrefix = `issue34_rehearsal_${runId}`
const legacyRestoreName = `${databasePrefix}_legacy`
const canonicalRestoreName = `${databasePrefix}_canonical`
const legacyDump = join(tmpdir(), `${databasePrefix}_legacy.dump`)
const canonicalDump = join(tmpdir(), `${databasePrefix}_canonical.dump`)
const approvalPath = join(tmpdir(), `${databasePrefix}_approval.json`)
const resetApprovalPath = join(
  tmpdir(),
  `${databasePrefix}_reset-approval.json`
)
const backupVerificationPath = join(
  tmpdir(),
  `${databasePrefix}_backup-verification.json`
)
const startedAt = Date.now()

const CUTOVER_TABLES = [
  "branch_trees",
  "branch_generations",
  "branch_message_feedback",
  "usage_records",
  "conversations",
  "conversation_threads",
  "thread_forks",
  "conversation_turns",
  "conversation_messages",
  "conversation_generations",
  "conversation_artifacts",
  "conversation_message_feedback",
  "legacy_conversation_entity_mappings",
]

function databaseUrl(name) {
  const url = new URL(sourceUrl)
  url.pathname = `/${name}`
  return url.toString()
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} ${args.join(" ")} 退出码 ${result.status}`)
  }
  return result.stdout
}

async function createDatabase(admin, name) {
  if (!name.startsWith("issue34_rehearsal_"))
    throw new Error("拒绝创建非演练数据库")
  await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`)
}

async function dropDatabase(admin, name) {
  if (!name.startsWith("issue34_rehearsal_"))
    throw new Error("拒绝删除非演练数据库")
  await admin`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${name} AND pid <> pg_backend_pid()
  `
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`)
}

async function fingerprint(url) {
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const tables = {}
    for (const table of CUTOVER_TABLES) {
      const [exists] = await sql`
        SELECT to_regclass(${`thread_chat.${table}`})::text AS value
      `
      if (!exists?.value) {
        tables[table] = { count: 0, hash: "missing" }
        continue
      }
      const [row] = await sql.unsafe(
        `SELECT count(*)::int AS count,
          COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
        FROM thread_chat."${table}" t`
      )
      const serialized = JSON.stringify(row.rows)
      tables[table] = {
        count: row.count,
        hash: createHash("sha256").update(serialized).digest("hex"),
      }
    }
    const hash = createHash("sha256")
      .update(JSON.stringify(tables))
      .digest("hex")
    return { hash, tables }
  } finally {
    await sql.end()
  }
}

function cutoverEnv(url, approvalId, extra = {}) {
  return {
    ...process.env,
    DATABASE_URL: url,
    DIRECT_URL: url,
    CONVERSATION_AUTHORITY: "legacy",
    CONVERSATION_MAINTENANCE_MODE: "read-only",
    CONVERSATION_ISOLATED_TEST: "true",
    CONVERSATION_CUTOVER_APPROVAL_ID: approvalId,
    ...extra,
  }
}

async function resetCounts(url) {
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const [row] = await sql`SELECT
      (SELECT count(*)::int FROM thread_chat.branch_trees) AS "legacyTrees",
      (SELECT count(*)::int FROM thread_chat.branch_generations) AS "legacyGenerations",
      (SELECT count(*)::int FROM thread_chat.branch_message_feedback) AS "legacyFeedback",
      (SELECT count(*)::int FROM thread_chat.legacy_conversation_entity_mappings) AS mappings,
      (SELECT count(*)::int FROM thread_chat.conversations c WHERE c.id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings WHERE entity_type = 'conversation'
      )) AS "canonicalConversations",
      (SELECT count(*)::int FROM thread_chat.conversation_generations g WHERE g.conversation_id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings WHERE entity_type = 'conversation'
      )) AS "canonicalGenerations",
      (SELECT count(*)::int FROM thread_chat.conversation_message_feedback f WHERE f.conversation_id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings WHERE entity_type = 'conversation'
      )) AS "canonicalFeedback",
      (SELECT count(*)::int FROM thread_chat.conversation_artifacts a WHERE a.conversation_id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings WHERE entity_type = 'conversation'
      )) AS "canonicalArtifacts",
      (SELECT count(*)::int FROM thread_chat.conversation_command_records r WHERE r.scope_id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings
      )) AS "commandRecords",
      (SELECT count(*)::int FROM thread_chat.conversation_outbox_events e WHERE e.aggregate_id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings
      )) AS "outboxEvents",
      (SELECT count(*)::int FROM thread_chat.usage_records u WHERE u.app_generation_id IN (
        SELECT canonical_id FROM thread_chat.legacy_conversation_entity_mappings WHERE entity_type = 'generation'
        UNION
        SELECT local_id FROM thread_chat.legacy_conversation_entity_mappings WHERE entity_type = 'generation'
      )) AS "preservedUsageRecords"`
    return row
  } finally {
    await sql.end()
  }
}

const adminUrl = new URL(sourceUrl)
adminUrl.pathname = "/postgres"
const admin = postgres(adminUrl.toString(), { max: 1, prepare: false })

try {
  await createDatabase(admin, legacyRestoreName)
  const sourceFingerprint = await fingerprint(sourceUrl.toString())

  run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--file=${legacyDump}`,
    sourceUrl.toString(),
  ])
  const legacyDumpHash = createHash("sha256")
    .update(await readFile(legacyDump))
    .digest("hex")
  run("pg_restore", [
    "--no-owner",
    "--no-privileges",
    `--dbname=${databaseUrl(legacyRestoreName)}`,
    legacyDump,
  ])

  const restoredLegacyFingerprint = await fingerprint(
    databaseUrl(legacyRestoreName)
  )
  if (restoredLegacyFingerprint.hash !== sourceFingerprint.hash)
    throw new Error("legacy 备份恢复后的 cutover 表指纹与源库不一致")

  const approvalId = `local-rehearsal-${runId}`
  const approval = {
    schemaVersion: 1,
    action: "deterministic-import",
    environment: "local-ephemeral-cutover-rehearsal",
    database: {
      host: sourceUrl.hostname,
      name: legacyRestoreName,
    },
    scope: { legacyTreeIds: "all" },
    backupId: `sha256:${legacyDumpHash}`,
    approvalId,
    approvedBy: "local-cutover-rehearsal",
    approvedAt: new Date().toISOString(),
    approvedRepairs: ["missing-generation-intent-as-send"],
  }
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`)
  const env = cutoverEnv(databaseUrl(legacyRestoreName), approvalId)

  run(
    "pnpm",
    ["exec", "tsx", "scripts/check-conversation-cutover-drain.ts"],
    env
  )
  run("pnpm", ["exec", "tsx", "scripts/audit-legacy-conversations.ts"], env)
  run(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/import-legacy-conversations.ts",
      "--execute",
      "--approval-file",
      approvalPath,
    ],
    env
  )
  // 第二次正式执行必须是幂等重放，而不是产生第二套 canonical 实体。
  run(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/import-legacy-conversations.ts",
      "--execute",
      "--approval-file",
      approvalPath,
    ],
    env
  )

  const importedFingerprint = await fingerprint(databaseUrl(legacyRestoreName))
  await createDatabase(admin, canonicalRestoreName)
  run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--file=${canonicalDump}`,
    databaseUrl(legacyRestoreName),
  ])
  const canonicalDumpHash = createHash("sha256")
    .update(await readFile(canonicalDump))
    .digest("hex")
  run("pg_restore", [
    "--no-owner",
    "--no-privileges",
    `--dbname=${databaseUrl(canonicalRestoreName)}`,
    canonicalDump,
  ])
  const restoredCanonicalFingerprint = await fingerprint(
    databaseUrl(canonicalRestoreName)
  )
  if (restoredCanonicalFingerprint.hash !== importedFingerprint.hash)
    throw new Error("canonical 备份恢复后的 cutover 表指纹与导入库不一致")

  // 在已恢复的 canonical 备份副本上走完整 reset SQL，但强制事务回滚。
  const resetApprovalId = `local-reset-rehearsal-${runId}`
  const resetBackupId = `sha256:${canonicalDumpHash}`
  const resetApproval = {
    schemaVersion: 1,
    action: "approved-conversation-reset",
    environment: "local-ephemeral-cutover-rehearsal",
    database: {
      host: sourceUrl.hostname,
      name: canonicalRestoreName,
    },
    scope: { legacyTreeIds: "all" },
    expected: await resetCounts(databaseUrl(canonicalRestoreName)),
    backupId: resetBackupId,
    approvalId: resetApprovalId,
    approvedBy: "local-cutover-rehearsal",
    approvedAt: new Date().toISOString(),
    reason: "本地临时恢复库的事务回滚演练",
  }
  const backupVerification = {
    schemaVersion: 1,
    action: "conversation-backup-verification",
    environment: resetApproval.environment,
    database: resetApproval.database,
    backupId: resetBackupId,
    backupSha256: canonicalDumpHash,
    restoreTestId: `local-restore-${runId}`,
    verifiedAt: new Date().toISOString(),
    verifiedBy: "local-cutover-rehearsal",
  }
  await writeFile(
    resetApprovalPath,
    `${JSON.stringify(resetApproval, null, 2)}\n`
  )
  await writeFile(
    backupVerificationPath,
    `${JSON.stringify(backupVerification, null, 2)}\n`
  )
  run(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/reset-approved-conversations.ts",
      "--test-rollback",
      "--approval-file",
      resetApprovalPath,
      "--backup-verification-file",
      backupVerificationPath,
    ],
    cutoverEnv(databaseUrl(canonicalRestoreName), resetApprovalId, {
      CONVERSATION_CUTOVER_ENVIRONMENT: resetApproval.environment,
      CONVERSATION_CUTOVER_BACKUP_ID: resetBackupId,
      CONVERSATION_APPROVED_RESET_ENABLED: "true",
    })
  )
  const postResetRollbackFingerprint = await fingerprint(
    databaseUrl(canonicalRestoreName)
  )
  if (postResetRollbackFingerprint.hash !== restoredCanonicalFingerprint.hash)
    throw new Error("受批准 reset 回滚演练改变了恢复库指纹")

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "local-ephemeral-cutover-rehearsal",
        sourceDatabase: sourceUrl.pathname.slice(1),
        legacyBackup: {
          id: `sha256:${legacyDumpHash}`,
          sourceFingerprint: sourceFingerprint.hash,
          restoredFingerprint: restoredLegacyFingerprint.hash,
          matches: restoredLegacyFingerprint.hash === sourceFingerprint.hash,
        },
        canonicalBackup: {
          id: `sha256:${canonicalDumpHash}`,
          sourceFingerprint: importedFingerprint.hash,
          restoredFingerprint: restoredCanonicalFingerprint.hash,
          matches:
            restoredCanonicalFingerprint.hash === importedFingerprint.hash,
        },
        imported: {
          conversations: importedFingerprint.tables.conversations?.count ?? 0,
          mappings:
            importedFingerprint.tables.legacy_conversation_entity_mappings
              ?.count ?? 0,
        },
        approvedReset: {
          mode: "test-rollback",
          scope: "all-legacy-mapped-conversations",
          sourceFingerprint: restoredCanonicalFingerprint.hash,
          rollbackFingerprint: postResetRollbackFingerprint.hash,
          matches:
            postResetRollbackFingerprint.hash ===
            restoredCanonicalFingerprint.hash,
          preservedUsageRecords: resetApproval.expected.preservedUsageRecords,
        },
        elapsedMs: Date.now() - startedAt,
      },
      null,
      2
    )
  )
} finally {
  await dropDatabase(admin, canonicalRestoreName).catch(() => undefined)
  await dropDatabase(admin, legacyRestoreName).catch(() => undefined)
  await admin.end()
  await Promise.all([
    rm(legacyDump, { force: true }),
    rm(canonicalDump, { force: true }),
    rm(approvalPath, { force: true }),
    rm(resetApprovalPath, { force: true }),
    rm(backupVerificationPath, { force: true }),
  ])
}
