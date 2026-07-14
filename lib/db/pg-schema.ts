import { pgSchema } from "drizzle-orm/pg-core"

// 本项目所有表都放进这个独立的 Postgres schema，与同一个数据库里其他 project 的表隔离
// （典型场景：多个项目共用一个 Supabase 数据库）。所有表定义用 dbSchema.table(...) 而非 pgTable。
//
// ⚠️ 改名需同步：删除 drizzle/ 下迁移与 meta 后重新 `pnpm db:generate`，并确保连接的
// search_path 一致（见 lib/db/index.ts 与 drizzle.config.ts）。
export const DB_SCHEMA = "thread_chat"

export const dbSchema = pgSchema(DB_SCHEMA)
