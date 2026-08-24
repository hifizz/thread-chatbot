import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { config } from "dotenv"
import postgres from "postgres"

config({ path: ".env.local" })

if (!process.argv.includes("--execute"))
  throw new Error("创建并验证本地备份必须显式传入 --execute")

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) throw new Error("未配置 DIRECT_URL 或 DATABASE_URL")
const sourceUrl = new URL(rawUrl.trim().replace(/^(['"])(.*)\1$/u, "$2"))
if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname))
  throw new Error("本工具只允许备份 localhost/loopback 数据库")

const sourceDatabase = sourceUrl.pathname.slice(1)
if (!sourceDatabase) throw new Error("数据库 URL 缺少数据库名")

const runId = randomUUID().replaceAll("-", "").slice(0, 12)
const restoreDatabase = `issue34_backup_verify_${runId}`
const backupDir = resolve(".local-backups")
const backupBase = `issue34-${sourceDatabase}-${new Date().toISOString().replaceAll(":", "-")}`
const dumpPath = resolve(backupDir, `${backupBase}.dump`)
const verificationPath = resolve(backupDir, `${backupBase}.verification.json`)

function databaseUrl(name) {
  const url = new URL(sourceUrl)
  url.pathname = `/${name}`
  return url.toString()
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} 执行失败，退出码 ${result.status}`)
  }
}

async function fingerprint(url) {
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const tables = await sql`
      SELECT tablename AS name
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'thread_chat'
      ORDER BY tablename
    `
    const results = {}
    for (const { name } of tables) {
      if (!/^[a-z0-9_]+$/u.test(name))
        throw new Error(`拒绝指纹化异常表名：${name}`)
      const [row] = await sql.unsafe(
        `SELECT count(*)::int AS count,
          COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
        FROM thread_chat."${name}" t`
      )
      results[name] = {
        count: row.count,
        sha256: createHash("sha256")
          .update(JSON.stringify(row.rows))
          .digest("hex"),
      }
    }
    return {
      sha256: createHash("sha256")
        .update(JSON.stringify(results))
        .digest("hex"),
      tables: results,
    }
  } finally {
    await sql.end()
  }
}

if (!restoreDatabase.startsWith("issue34_backup_verify_"))
  throw new Error("拒绝使用不安全的恢复验证数据库名")

await mkdir(backupDir, { recursive: true })
const sourceFingerprint = await fingerprint(sourceUrl.toString())
const adminUrl = new URL(sourceUrl)
adminUrl.pathname = "/postgres"
const admin = postgres(adminUrl.toString(), { max: 1, prepare: false })

try {
  await admin.unsafe(`CREATE DATABASE "${restoreDatabase}" TEMPLATE template0`)
  run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--file=${dumpPath}`,
    sourceUrl.toString(),
  ])
  const dumpSha256 = createHash("sha256")
    .update(await readFile(dumpPath))
    .digest("hex")
  run("pg_restore", [
    "--no-owner",
    "--no-privileges",
    `--dbname=${databaseUrl(restoreDatabase)}`,
    dumpPath,
  ])
  const restoredFingerprint = await fingerprint(databaseUrl(restoreDatabase))
  if (restoredFingerprint.sha256 !== sourceFingerprint.sha256)
    throw new Error("恢复库逐表指纹与源库不一致；备份验证失败")

  const verifiedAt = new Date().toISOString()
  const verification = {
    schemaVersion: 1,
    action: "conversation-backup-verification",
    environment: "local-development-cutover",
    database: { host: sourceUrl.hostname, name: sourceDatabase },
    backupId: `sha256:${dumpSha256}`,
    backupSha256: dumpSha256,
    restoreTestId: `local-restore-${runId}`,
    verifiedAt,
    verifiedBy: "issue-34-local-cutover",
    sourceFingerprint: sourceFingerprint.sha256,
    restoredFingerprint: restoredFingerprint.sha256,
    tableCounts: Object.fromEntries(
      Object.entries(sourceFingerprint.tables).map(([name, value]) => [
        name,
        value.count,
      ])
    ),
    dumpPath,
  }
  await writeFile(verificationPath, `${JSON.stringify(verification, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, verificationPath, ...verification }, null, 2))
} finally {
  await admin`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${restoreDatabase} AND pid <> pg_backend_pid()
  `.catch(() => undefined)
  await admin.unsafe(`DROP DATABASE IF EXISTS "${restoreDatabase}"`)
  await admin.end()
}
