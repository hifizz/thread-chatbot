// 部署构建期的迁移守卫。
//
// 语义：
// · 配置了数据库连接串（DIRECT_URL 或 DATABASE_URL）→ 校验迁移历史后执行迁移；
// · 未配置连接串 → 跳过迁移并正常退出；
// · 迁移历史分叉或迁移失败 → 输出不含凭据的结构化诊断并中断部署。

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const MIGRATIONS_FOLDER = "./drizzle"
const MIGRATIONS_SCHEMA = "drizzle"
const MIGRATIONS_TABLE = "__drizzle_migrations"

// Preview 默认共享项目数据库；在 build 阶段自动跑 DDL 会让多个分支争用同一迁移日志。
// 只有为该 Preview 配置了隔离数据库并显式确认时才允许迁移。
if (
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_PREVIEW_DATABASE_MIGRATIONS !== "true"
) {
  console.log(
    "[vercel-build] Preview 默认不执行数据库迁移；构建继续。若使用隔离预览库，请显式设置 VERCEL_PREVIEW_DATABASE_MIGRATIONS=true。"
  )
  process.exit(0)
}

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!rawUrl) {
  console.log(
    "[vercel-build] 未配置 DATABASE_URL/DIRECT_URL，跳过数据库迁移（构建继续）。"
  )
  process.exit(0)
}

function normalizedDatabaseUrl(value) {
  const candidate = value.trim().replace(/^(['"])(.*)\1$/, "$2")
  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new Error(
      "数据库连接串无法解析；应形如 postgres://用户:密码@主机:端口/库名，且不得带引号或多余空白。"
    )
  }
  url.searchParams.set(
    "options",
    "-c search_path=thread_chat,public,extensions"
  )
  return url.toString()
}

async function localMigrationManifest() {
  const journal = JSON.parse(
    await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")
  )
  return Promise.all(
    journal.entries.map(async (entry) => {
      const sql = await readFile(
        `${MIGRATIONS_FOLDER}/${entry.tag}.sql`,
        "utf8"
      )
      return {
        createdAt: String(entry.when),
        hash: createHash("sha256").update(sql).digest("hex"),
        tag: entry.tag,
      }
    })
  )
}

async function readAppliedMigrations(sql) {
  const [{ migrationTable }] = await sql`
    SELECT to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`})::text AS "migrationTable"
  `
  if (!migrationTable) return []
  return sql`
    SELECT created_at::text AS "createdAt", hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `
}

function validateLinearHistory(local, applied) {
  const appliedByTimestamp = new Map()
  for (const migration of applied) {
    const sameTimestamp = appliedByTimestamp.get(migration.createdAt)
    if (sameTimestamp && sameTimestamp.hash !== migration.hash) {
      throw new Error(
        `数据库迁移历史的时间戳 ${migration.createdAt} 对应多个不同哈希，无法建立单一谱系。`
      )
    }
    appliedByTimestamp.set(migration.createdAt, migration)
  }

  const lastAppliedAt = Math.max(
    0,
    ...applied.map((migration) => Number(migration.createdAt))
  )
  const pending = []
  let appliedCount = 0
  for (const expected of local) {
    const actual = appliedByTimestamp.get(expected.createdAt)
    if (actual) {
      if (actual.hash !== expected.hash) {
        throw new Error(
          `数据库迁移历史在 ${expected.tag} 处分叉：期望 ${expected.hash.slice(0, 12)}，实际为 ${actual.hash.slice(0, 12)}。拒绝自动覆盖。`
        )
      }
      appliedCount += 1
      continue
    }
    if (Number(expected.createdAt) <= lastAppliedAt) {
      throw new Error(
        `数据库缺少 ${expected.tag}，但日志中已有时间更晚的迁移。Drizzle 会永久跳过该迁移，必须先人工修复谱系。`
      )
    }
    pending.push(expected)
  }

  return {
    appliedCount,
    extraCount: applied.length - appliedCount,
    pending,
  }
}

function safeError(error) {
  if (!(error instanceof Error)) return { message: String(error) }
  const fields = [
    "code",
    "constraint_name",
    "detail",
    "hint",
    "message",
    "schema_name",
    "table_name",
  ]
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = error[field]
      return typeof value === "string" && value.length > 0
        ? [[field, value]]
        : []
    })
  )
}

const client = postgres(normalizedDatabaseUrl(rawUrl), {
  max: 1,
  prepare: false,
})

try {
  const local = await localMigrationManifest()
  const applied = await readAppliedMigrations(client)
  const { appliedCount, extraCount, pending } = validateLinearHistory(
    local,
    applied
  )

  console.log(
    `[vercel-build] 迁移历史通过校验：当前谱系已应用 ${appliedCount}，其他已知历史 ${extraCount}，待应用 ${pending.length}${
      pending.length > 0
        ? `（${pending[0].tag} → ${pending.at(-1).tag}）`
        : ""
    }。`
  )

  await migrate(drizzle(client), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  })
  console.log("[vercel-build] 数据库迁移完成。")
} catch (error) {
  console.error(
    "[vercel-build] 数据库迁移失败：",
    JSON.stringify(safeError(error))
  )
  process.exitCode = 1
} finally {
  await client.end({ timeout: 5 })
}
