import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"
import { migrate } from "drizzle-orm/postgres-js/migrator"

config({ path: ".env.local" })
const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
const testUrl = new URL(source)
testUrl.pathname = "/thread-chat-normalized-test"
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [{ db }, schema, commands, { eq }, { DEFAULT_THREAD_CHAT_MODEL_ID: modelId }] = await Promise.all([
  import("../../lib/db/index.ts"), import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"), import("drizzle-orm"),
  import("../../constants/model.ts"),
])
const migrations = fileURLToPath(new URL("../../drizzle/", import.meta.url))
const previous = await mkdtemp(join(tmpdir(), "message-fork-upgrade-"))
const id = () => crypto.randomUUID()
const userId = `migration-${id()}`
let createdUser = false

try {
  // 仅在空的隔离测试库执行；已有数据时明确失败，禁止重置数据库。
  const existing = await db.$client`select to_regclass('thread_chat.threads') as table_name`
  assert.equal(existing[0].table_name, null, "需要先创建空的隔离测试库")
  const journal = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8"))
  const targetIndex = journal.entries.findIndex((entry) => entry.tag === "0008_motionless_wong")
  assert.ok(targetIndex > 0)
  const oldEntries = journal.entries.slice(0, targetIndex)
  await mkdir(join(previous, "meta"))
  await writeFile(join(previous, "meta/_journal.json"), JSON.stringify({ ...journal, entries: oldEntries }))
  for (const entry of oldEntries) await copyFile(join(migrations, `${entry.tag}.sql`), join(previous, `${entry.tag}.sql`))
  await migrate(db, { migrationsFolder: previous })

  await db.insert(schema.user).values({ id: userId, name: "迁移验收", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
  createdUser = true
  const start = { commandId: id(), projectId: id(), rootThreadId: id(), userMessageId: id(), assistantMessageId: id(), modelId, parts: [{ type: "text", text: "迁移验收问题" }] }
  await commands.startProject(userId, start)
  await db.update(schema.messages).set({ status: "completed", finishedAt: new Date(), parts: [{ type: "text", text: "迁移验收原文" }] }).where(eq(schema.messages.id, start.assistantMessageId))
  const fork = { commandId: id(), threadId: id(), sourceMessageId: start.assistantMessageId, modelId }
  await commands.forkThread(userId, start.rootThreadId, { ...fork, anchorText: "迁移验收原文", anchor: { quote: { exact: "迁移验收原文", prefix: "", suffix: "" } } })
  const before = await db.select().from(schema.threads).where(eq(schema.threads.projectId, start.projectId))
  const direct = { ...fork, commandId: id(), threadId: id() }
  await assert.rejects(() => commands.forkThread(userId, start.rootThreadId, direct), (error) => {
    const cause = error.cause ?? error
    return cause.code === "23514" && cause.constraint_name === "threads_root_or_fork_shape"
  })

  await migrate(db, { migrationsFolder: migrations })
  const after = await db.select().from(schema.threads).where(eq(schema.threads.projectId, start.projectId))
  const sorted = (rows) => rows.sort((a, b) => a.id.localeCompare(b.id))
  assert.deepEqual(sorted(after), sorted(before))
  const result = await commands.forkThread(userId, start.rootThreadId, direct)
  assert.equal(result.result.thread.anchorText, null)
  assert.equal(result.result.thread.forkAnchor, null)
  assert.equal(result.result.generation, null)
  assert.equal(result.result.thread.forkContext.at(-1), start.assistantMessageId)
  assert.equal((await commands.forkThread(userId, start.rootThreadId, direct)).replayed, true)
  await migrate(db, { migrationsFolder: migrations })
  console.log("PASS 原生数据库完整旧迁移链 → 新迁移：旧数据不变、直接分叉由拒绝变为接受、失败事务可重试、幂等与重复迁移")
} finally {
  if (createdUser) await db.delete(schema.user).where(eq(schema.user.id, userId))
  await rm(previous, { recursive: true, force: true })
  await globalThis.__dbClient?.end()
}
