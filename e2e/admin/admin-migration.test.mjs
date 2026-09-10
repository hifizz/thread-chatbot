import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"

// Test-only PGlite dependency location; never connects to a configured database.
const require = createRequire(import.meta.url)
const { PGlite } = require(process.env.ADMIN_MIGRATION_PGLITE || "@electric-sql/pglite")
const { vector } = require(process.env.ADMIN_MIGRATION_VECTOR || "@electric-sql/pglite-pgvector")
const { drizzle } = await import("drizzle-orm/pglite")
const { migrate } = await import("drizzle-orm/pglite/migrator")
const folder = await mkdtemp(join(tmpdir(), "admin-migration-"))
const client = await PGlite.create({ extensions: { vector } })
try {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"))
  const previous = journal.entries.filter((entry) => entry.idx < 8)
  await mkdir(join(folder, "meta"))
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: previous }))
  for (const entry of previous) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`))
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: folder })
  await client.exec(`INSERT INTO thread_chat."user" (id, name, email, email_verified, created_at, updated_at) VALUES ('migration-test', 'Migration Test', 'migration@example.test', false, now(), now())`)
  const before = await client.query('SELECT * FROM thread_chat."user" ORDER BY id')
  await migrate(db, { migrationsFolder: "drizzle" })
  assert.deepEqual((await client.query('SELECT * FROM thread_chat."user" ORDER BY id')).rows, before.rows)
  assert.equal((await client.query("SELECT * FROM thread_chat.admin_members")).rows.length, 0)
  await client.exec("INSERT INTO thread_chat.admin_members (user_id) VALUES ('migration-test') ON CONFLICT DO NOTHING")
  await client.exec("INSERT INTO thread_chat.admin_members (user_id) VALUES ('migration-test') ON CONFLICT DO NOTHING")
  assert.equal((await client.query("SELECT * FROM thread_chat.admin_members")).rows.length, 1)
  await assert.rejects(client.exec("INSERT INTO thread_chat.admin_members (user_id) VALUES ('missing')"))
  await migrate(db, { migrationsFolder: "drizzle" })
  assert.equal((await client.query("SELECT * FROM thread_chat.admin_members")).rows.length, 1)
  await client.exec(`DELETE FROM thread_chat."user" WHERE id = 'migration-test'`)
  assert.equal((await client.query("SELECT * FROM thread_chat.admin_members")).rows.length, 0)
  console.log("PASS: previous migrations → admin migration; preserved users, foreign key, idempotent grant/migrate, cascade deletion (isolated PGlite)")
} finally {
  await client.close()
  await rm(folder, { recursive: true, force: true })
}
