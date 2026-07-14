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
})
