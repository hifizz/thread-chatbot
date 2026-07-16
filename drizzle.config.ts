import { defineConfig } from "drizzle-kit"
import { config } from "dotenv"
import { DB_SCHEMA } from "./lib/db/pg-schema"

config({ path: ".env.local" })

// 迁移走「直连」(DIRECT_URL)：Supabase 事务连接池不适合跑 DDL / 迁移；无 DIRECT_URL 则回退 DATABASE_URL。
const usedVar = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL"
// 归一化：去掉首尾空白与成对引号——在 Vercel/CI 面板粘贴连接串时常带上引号，
// 会让 new URL() 直接抛 "Invalid URL" 而中断部署。
const base = (process.env.DIRECT_URL || process.env.DATABASE_URL || "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2")

// 迁移会话的 search_path 覆盖扩展 schema，使 vector 类型可解析
// （Supabase 上 pgvector 通常装在 extensions schema），并把本项目 schema 放最前。
function withSearchPath(u: string): string {
  if (!u) {
    throw new Error(
      `[drizzle.config] 未配置数据库连接串：请设置 DIRECT_URL 或 DATABASE_URL。`
    )
  }
  let url: URL
  try {
    url = new URL(u)
  } catch {
    // 不打印取值本身（含密码）；只指明是哪个变量、应有的形状
    throw new Error(
      `[drizzle.config] ${usedVar} 不是合法的数据库连接串（无法解析为 URL）。` +
        `请检查其值：应形如 postgres://用户:密码@主机:端口/库名，且不要带引号或多余空白/换行。`
    )
  }
  url.searchParams.set(
    "options",
    `-c search_path=${DB_SCHEMA},public,extensions`
  )
  return url.toString()
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: withSearchPath(base) },
  // 本项目所有表都在自定义 schema `thread_chat` 里。drizzle-kit 的 schemaFilter 默认只认
  // ["public"]，不显式指定会导致 push/pull 把 thread_chat 的表当作「不归我管」全部忽略
  // （表现为对空库也报「No changes」）。这里显式指向本项目 schema。
  schemaFilter: [DB_SCHEMA],
})
