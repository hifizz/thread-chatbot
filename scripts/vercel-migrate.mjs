// 部署构建期的迁移守卫。
//
// 语义：
// · 配置了数据库连接串（DIRECT_URL 或 DATABASE_URL）→ 跑 `pnpm db:migrate`；
//   迁移失败则以非零码退出，从而中断部署（保持「迁移不过就不部署」）。
// · 未配置连接串 → 跳过迁移并正常退出，让「尚未配置数据库的 Vercel 预览构建」也能通过，
//   而不是在 `db:migrate` 连不上库时直接失败。
//
// 之所以需要它：`vercel-build` 会在 build 前跑迁移，但预览环境/尚未配置密钥的项目
// 读不到连接串，drizzle-kit 会因无法解析/连接而失败，连带整个部署失败。

import { spawnSync } from "node:child_process"

const url = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!url) {
  console.log(
    "[vercel-build] 未配置 DATABASE_URL/DIRECT_URL，跳过数据库迁移（构建继续）。"
  )
  process.exit(0)
}

console.log("[vercel-build] 检测到数据库连接串，执行迁移…")
const res = spawnSync("pnpm", ["db:migrate"], { stdio: "inherit" })
// 迁移失败（非零/被信号中断）→ 让 vercel-build 的 && 短路，中断部署
process.exit(res.status ?? 1)
