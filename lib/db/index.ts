import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"
import { DB_SCHEMA } from "./pg-schema"

declare global {
  var __dbClient: ReturnType<typeof postgres> | undefined
}

// 应用连接：面向 Supabase「事务连接池」(transaction pooler) 优化。
// - prepare:false —— 事务池不支持预处理语句（直连也可，仅略微性能损失）；直连/会话池
//   想启用可设 DB_PREPARE=true。
// - search_path —— 让 vector 等扩展的类型/运算符可解析，并把本项目 schema 置于默认位置
//   （表本身已 schema 限定，此项主要服务可选的 RAG 向量检索）。
// - max —— 每实例连接数上限，Serverless + 池化下宜小，可用 DB_POOL_MAX 调整。
const client =
  globalThis.__dbClient ??
  postgres(process.env.DATABASE_URL!, {
    max: Number(process.env.DB_POOL_MAX) || 10,
    prepare: process.env.DB_PREPARE === "true",
    connection: { search_path: `${DB_SCHEMA},extensions,public` },
  })
if (process.env.NODE_ENV !== "production") globalThis.__dbClient = client

export const db = drizzle(client, { schema })
