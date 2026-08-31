import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import postgres from "postgres"

const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")

const baseUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
const databaseName = "thread-chat-project-workspace-migration-test"
const admin = postgres(baseUrl.toString(), { max: 1 })
const databaseUrl = new URL(baseUrl)
databaseUrl.pathname = `/${databaseName}`
const sql = postgres(databaseUrl.toString(), { max: 1 })

function migrationPath(index, name) {
  return new URL(`../../drizzle/${String(index).padStart(4, "0")}_${name}.sql`, import.meta.url)
}

const migrations = [
  migrationPath(0, "milky_ghost_rider"),
  migrationPath(1, "mysterious_wendigo"),
  migrationPath(2, "complex_millenium_guard"),
  migrationPath(3, "strong_bulldozer"),
  migrationPath(4, "normalized_thread_chat_conversations"),
  migrationPath(5, "legacy_thread_chat_backup"),
  migrationPath(6, "ambitious_silk_fever"),
]
const workspaceMigration = new URL(
  "../../drizzle/0007_project_workspace_mvp.sql",
  import.meta.url
)

async function applyMigration(file) {
  const sourceText = await readFile(file, "utf8")
  const statements = sourceText
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
  for (const statement of statements) await sql.unsafe(statement)
}

const id = () => crypto.randomUUID()
const userId = `migration-user-${id()}`
const projectId = id()
const threadId = id()
const userMessageId = id()
const assistantMessageId = id()
const artifactId = id()
const now = new Date()

try {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)

  for (const migration of migrations) await applyMigration(migration)

  await sql`
    insert into thread_chat.user
      (id, name, email, email_verified, created_at, updated_at)
    values
      (${userId}, 'Legacy Workspace User', ${`${userId}@example.test`}, true, ${now}, ${now})
  `
  await sql`
    insert into thread_chat.projects
      (id, user_id, next_footnote, created_at, updated_at)
    values
      (${projectId}, ${userId}, 1, ${now}, ${now})
  `
  await sql`
    insert into thread_chat.threads
      (id, project_id, parent_id, fork_context, depth, model_id, next_sequence, created_at, updated_at)
    values
      (${threadId}, ${projectId}, null, ${sql.json([])}, 0, 'legacy-model', 3, ${now}, ${now})
  `
  await sql`
    insert into thread_chat.messages
      (id, project_id, thread_id, sequence, role, parts, status, model_id, started_at, finished_at, created_at, updated_at)
    values
      (${userMessageId}, ${projectId}, ${threadId}, 1, 'user', ${sql.json([{ type: "text", text: "legacy question" }])}, 'completed', null, null, ${now}, ${now}, ${now}),
      (${assistantMessageId}, ${projectId}, ${threadId}, 2, 'assistant', ${sql.json([{ type: "text", text: "legacy answer" }])}, 'completed', 'legacy-model', ${now}, ${now}, ${now}, ${now})
  `
  await sql`
    insert into thread_chat.artifacts
      (id, project_id, source_message_id, kind, title, content, metadata, created_at, updated_at)
    values
      (${artifactId}, ${projectId}, ${assistantMessageId}, 'markdown', 'Legacy Artifact', '# Legacy', ${sql.json({ legacy: true })}, ${now}, ${now})
  `

  const before = await sql`
    select
      p.id as project_id,
      m.id as message_id,
      a.id as artifact_id,
      a.content as artifact_content
    from thread_chat.projects p
    join thread_chat.messages m on m.project_id = p.id and m.id = ${assistantMessageId}
    join thread_chat.artifacts a on a.project_id = p.id and a.id = ${artifactId}
    where p.id = ${projectId}
  `
  assert.equal(before.length, 1)

  await applyMigration(workspaceMigration)

  const [project] = await sql`
    select target, instructions, contract_version
    from thread_chat.projects
    where id = ${projectId}
  `
  assert.equal(project.target, null)
  assert.equal(project.instructions, null)
  assert.equal(project.contract_version, 0)

  const files = await sql`
    select * from thread_chat.project_files where project_id = ${projectId}
  `
  assert.equal(files.length, 0)

  const [artifact] = await sql`
    select id, project_id, thread_id, source_message_id, content, metadata
    from thread_chat.artifacts
    where id = ${artifactId}
  `
  assert.equal(artifact.project_id, projectId)
  assert.equal(artifact.thread_id, threadId)
  assert.equal(artifact.source_message_id, assistantMessageId)
  assert.equal(artifact.content, "# Legacy")
  assert.deepEqual(artifact.metadata, { legacy: true })

  const messages = await sql`
    select id, role, parts, status
    from thread_chat.messages
    where project_id = ${projectId}
    order by sequence
  `
  assert.equal(messages.length, 2)
  assert.equal(messages[0].id, userMessageId)
  assert.equal(messages[1].id, assistantMessageId)
  assert.deepEqual(messages[1].parts, [{ type: "text", text: "legacy answer" }])

  console.log("project workspace legacy migration compatibility tests passed")
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined)
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined)
  await admin.end({ timeout: 5 }).catch(() => undefined)
}
