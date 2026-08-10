import {
  text,
  timestamp,
  integer,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { dbSchema } from "./pg-schema"
import { user } from "./auth-schema"

// 计费相关表。金额一律用「微元」整数存储（1 元 = 1_000_000 微元），
// 避免浮点误差；换算与展示见 constants/pricing.ts 与 lib/billing/*。

// 用户余额（预付费额度）。注册时按 constants/pricing.ts 的初始额度赠送。
export const userCredits = dbSchema.table("user_credits", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balanceMicros: bigint("balance_micros", { mode: "number" })
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// 逐次调用的用量与费用流水，用于账单、对账与前端 token 统计。
export const usageRecords = dbSchema.table(
  "usage_records",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id"), // 关联对话（不加外键约束，避免删除对话时连带丢失账单）
    messageId: text("message_id"), // 关联 assistant 消息 id
    model: text("model").notNull(), // 模型注册表 id
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0), // 供应商成本（微元）
    priceMicros: bigint("price_micros", { mode: "number" })
      .notNull()
      .default(0), // 向用户收取（微元）
    // Vercel AI 网关的 generation id（gen_...）；用于事后拉取真实成本对账。直连/CF 时为空。
    generationId: text("generation_id"),
    // 成本口径：estimate=价目表估算（即时扣费用）；gateway=已用网关真实成本对账修正。
    costSource: text("cost_source", { enum: ["estimate", "gateway"] })
      .notNull()
      .default("estimate"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_records_user_id_idx").on(table.userId),
    index("usage_records_thread_id_idx").on(table.threadId),
    // 对账扫描：按来源筛未对账 + 有 generationId 的行
    index("usage_records_cost_source_idx").on(table.costSource),
  ]
)

// 外部工具逐次调用流水。与模型 token 用量分表，避免把 provider credit 伪装成
// token，也让失败尝试、shadow cost 和逐调用幂等语义可以独立审计。
export const externalUsageRecords = dbSchema.table(
  "external_usage_records",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id"),
    responseId: text("response_id"),
    requestId: text("request_id").notNull(),
    callIndex: integer("call_index").notNull(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    billableUnits: integer("billable_units").notNull().default(0),
    providerCostMicros: bigint("provider_cost_micros", { mode: "number" })
      .notNull()
      .default(0),
    userPriceMicros: bigint("user_price_micros", { mode: "number" })
      .notNull()
      .default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    resultCount: integer("result_count").notNull().default(0),
    queryFingerprint: text("query_fingerprint").notNull(),
    // 不保存完整 query。该 key 是 provider/requestId/callIndex 的 SHA-256，既用于
    // 唯一约束，也避免把可能含敏感文本的 requestId 组合复制进索引。
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("external_usage_records_idempotency_key_idx").on(
      table.idempotencyKey
    ),
    index("external_usage_records_user_id_idx").on(table.userId),
    index("external_usage_records_thread_id_idx").on(table.threadId),
    index("external_usage_records_response_id_idx").on(table.responseId),
    index("external_usage_records_provider_operation_idx").on(
      table.provider,
      table.operation
    ),
  ]
)
