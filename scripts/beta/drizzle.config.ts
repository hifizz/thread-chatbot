import { defineConfig } from "drizzle-kit"
import { DB_SCHEMA } from "../../lib/db/pg-schema"

// 仅用于可销毁的本机 Beta 验收库，不加载 .env.local，也不读取 DIRECT_URL。
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid")
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/thread_chat_eval_beta") {
  throw new Error("Beta schema push requires the isolated localhost database")
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: url.toString() },
  schemaFilter: [DB_SCHEMA],
})
