#!/usr/bin/env node
// Fly 发布流程中的迁移应用器：只应用 drizzle/ 里已审查的 migration 产物，
// 绝不在多实例启动时执行，也不生成新 migration（生成只属于 develop 集成流程）。
//
// 用法（在 CI/运维机执行，不在 Fly Machine 启动命令里）：
//   DIRECT_URL=... node scripts/fly-migrate.mjs
//
// 规则：
// - 必须有 DIRECT_URL（DDL 走直连，事务池不适合跑 migration）；
// - 必须有 --confirm <env>，且 env 是 staging 或 production，防止误跑；
// - 失败非零退出，让发布流水线中断，与 vercel-migrate 语义一致。

import { spawnSync } from "node:child_process"

const confirmIdx = process.argv.indexOf("--confirm")
const env = confirmIdx >= 0 ? process.argv[confirmIdx + 1] : undefined
if (env !== "staging" && env !== "production") {
  console.error(
    "用法: DIRECT_URL=... node scripts/fly-migrate.mjs --confirm <staging|production>"
  )
  process.exit(2)
}

if (!process.env.DIRECT_URL) {
  console.error("[fly-migrate] 缺少 DIRECT_URL：migration 必须走直连连接串")
  process.exit(2)
}

console.log(`[fly-migrate] 应用已审查 migration 到 ${env}…`)
const res = spawnSync("pnpm", ["db:migrate"], { stdio: "inherit" })
if (res.status !== 0) {
  console.error(`[fly-migrate] migration 失败（${res.status}），中断发布`)
  process.exit(res.status ?? 1)
}
console.log("[fly-migrate] migration 完成")
