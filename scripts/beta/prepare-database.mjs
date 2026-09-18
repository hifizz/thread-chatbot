import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import postgres from "postgres"

// 必须显式指定测试库；绝不从开发/生产环境文件推导连接串。
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid")
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "仅允许本机隔离数据库")
assert.equal(url.pathname, "/thread_chat_eval_beta", "拒绝非 Beta 验收库")
assert.ok(!process.env.DIRECT_URL, "验收不允许 DIRECT_URL 覆盖测试库")
const sql = postgres(url.toString(), { max: 1 })
try {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
} finally {
  await sql.end()
}
const result = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--config", "scripts/beta/drizzle.config.ts", "--force"], {
  stdio: "inherit", env: process.env,
})
if (result.error) throw result.error
if (result.signal || result.status !== 0) process.exit(result.status ?? 1)
