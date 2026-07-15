import { defineConfig } from "drizzle-kit"
import { config } from "dotenv"
import { DB_SCHEMA } from "./lib/db/pg-schema"

config({ path: ".env.local" })

// 迁移走「直连」(DIRECT_URL)：Supabase 事务连接池不适合跑 DDL / 迁移；无 DIRECT_URL 则回退 DATABASE_URL。
const base = process.env.DIRECT_URL || process.env.DATABASE_URL!

// 迁移会话的 search_path 覆盖扩展 schema，使 vector 类型可解析
// （Supabase 上 pgvector 通常装在 extensions schema），并把本项目 schema 放最前。
function withSearchPath(u: string): string {
  const url = new URL(u)
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
