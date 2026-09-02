import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { config } from "dotenv"
import postgres from "postgres"

config({ path: ".env.local" })

const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set(
  "options",
  "-c search_path=thread_chat,public,extensions"
)
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const sql = postgres(testUrl.toString(), { max: 1 })
const userId = `gate4-${crypto.randomUUID()}`
const legacyTreeId = crypto.randomUUID()
const legacyGenerationId = crypto.randomUUID()
const legacyMessageId = crypto.randomUUID()

async function exists(name) {
  const [row] = await sql`
    select exists(
      select 1 from information_schema.tables
      where table_schema = 'thread_chat' and table_name = ${name}
    ) as value
  `
  return row.value
}

async function count(name, user = null) {
  const rows = user
    ? await sql.unsafe(
        `select count(*)::int as value from "thread_chat"."${name}" where "user_id" = $1`,
        [user]
      )
    : await sql.unsafe(
        `select count(*)::int as value from "thread_chat"."${name}"`
      )
  return rows[0].value
}

async function runMigration(file) {
  const sourceSql = await readFile(file, "utf8")
  for (const statement of sourceSql.split("--> statement-breakpoint")) {
    if (statement.trim()) await sql.unsafe(statement)
  }
}

try {
  assert.equal(await exists("legacy_branch_trees_backup"), true)
  assert.equal(await exists("branch_trees"), false)
  assert.equal(await count("projects"), 0, "cutover 演练必须从空新表开始")
  assert.equal(await count("messages"), 0, "cutover 演练必须从空新表开始")

  await sql`alter table "thread_chat"."legacy_branch_trees_backup" rename to "branch_trees"`
  await sql`alter table "thread_chat"."legacy_branch_generations_backup" rename to "branch_generations"`
  await sql`alter table "thread_chat"."legacy_branch_message_feedback_backup" rename to "branch_message_feedback"`

  await sql`
    insert into "thread_chat"."user"
      ("id", "name", "email", "email_verified", "created_at", "updated_at")
    values
      (${userId}, 'Gate 4', ${`${userId}@example.test`}, true, now(), now())
  `
  await sql`
    insert into "thread_chat"."branch_trees"
      ("id", "user_id", "title", "state", "revision")
    values
      (${legacyTreeId}, ${userId}, 'legacy history', ${sql.json({ schemaVersion: 2, threads: {} })}, 0)
  `
  await sql`
    insert into "thread_chat"."branch_generations"
      ("id", "user_id", "tree_id", "thread_id", "user_message_id",
       "assistant_message_id", "attempt", "status", "model_id",
       "assistant_message_index", "turn_snapshot", "billing_status")
    values
      (${legacyGenerationId}, ${userId}, ${legacyTreeId}, 'main', 'legacy-user',
       ${legacyMessageId}, 1, 'failed', 'legacy-model', 1, ${sql.json({})}, 'pending')
  `
  await sql`
    insert into "thread_chat"."branch_message_feedback"
      ("user_id", "tree_id", "thread_id", "message_id", "feedback")
    values (${userId}, ${legacyTreeId}, 'main', ${legacyMessageId}, 'positive')
  `

  await runMigration("drizzle/0005_legacy_thread_chat_backup.sql")
  assert.equal(await exists("branch_trees"), false)
  assert.equal(await exists("branch_generations"), false)
  assert.equal(await exists("branch_message_feedback"), false)
  assert.equal(await count("legacy_branch_trees_backup", userId), 1)
  assert.equal(await count("legacy_branch_generations_backup", userId), 1)
  assert.equal(await count("legacy_branch_message_feedback_backup", userId), 1)
  assert.equal(await count("projects"), 0)

  const commands = await import("../../lib/thread-chat/application/index.ts")
  const constants = await import("../../constants/model.ts")
  const beforeCredits = await count("user_credits", userId)
  const beforeUsage = await count("usage_records", userId)
  const oldUrl = await commands.getProjectBootstrap(userId, legacyTreeId)
  assert.equal(oldUrl.project, null, "旧 URL 不得 fallback 到 legacy backup")

  const started = await commands.startProject(userId, {
    commandId: crypto.randomUUID(),
    projectId: legacyTreeId,
    rootThreadId: crypto.randomUUID(),
    userMessageId: crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
    modelId: constants.DEFAULT_THREAD_CHAT_MODEL_ID,
    text: "cutover 后第一条新消息",
    files: [],
  })
  assert.equal(started.replayed, false)
  assert.equal(await count("projects"), 1)
  assert.equal(await count("messages"), 2)
  assert.equal(await count("legacy_branch_trees_backup", userId), 1)
  assert.equal(await count("legacy_branch_generations_backup", userId), 1)
  assert.equal(await count("legacy_branch_message_feedback_backup", userId), 1)
  assert.equal(await count("user_credits", userId), beforeCredits)
  assert.equal(await count("usage_records", userId), beforeUsage)

  console.log("normalized cutover PostgreSQL rehearsal passed")
} finally {
  if (await exists("projects"))
    await sql`delete from "thread_chat"."projects" where "user_id" = ${userId}`
  if (await exists("legacy_branch_message_feedback_backup"))
    await sql`delete from "thread_chat"."legacy_branch_message_feedback_backup" where "user_id" = ${userId}`
  if (await exists("legacy_branch_generations_backup"))
    await sql`delete from "thread_chat"."legacy_branch_generations_backup" where "user_id" = ${userId}`
  if (await exists("legacy_branch_trees_backup"))
    await sql`delete from "thread_chat"."legacy_branch_trees_backup" where "user_id" = ${userId}`
  if (await exists("user"))
    await sql`delete from "thread_chat"."user" where "id" = ${userId}`
  await sql.end()
}
