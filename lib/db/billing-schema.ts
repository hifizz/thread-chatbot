import {
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
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
    // 应用级 generation id；thread-chat 用于计费幂等，普通线性聊天保持 null。
    appGenerationId: text("app_generation_id"),
    model: text("model").notNull(), // 模型注册表 id
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0), // 供应商成本（微元）
    priceMicros: bigint("price_micros", { mode: "number" })
      .notNull()
      .default(0), // 向用户收取（微元）
    // Vercel AI 网关的 generation id（gen_...）；用于事后拉取真实成本对账。直连/CF 时为空。
    generationId: text("generation_id"),
    // 成本口径：estimate=价目表估算；gateway=Vercel 对账；openrouter=OpenRouter 即时真实成本。
    costSource: text("cost_source", {
      enum: ["estimate", "gateway", "openrouter"],
    })
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
    uniqueIndex("usage_records_app_generation_id_uq").on(
      table.appGenerationId
    ),
  ]
)

/** 不可变额度流水。余额是快速读取值，流水是赠额、扣款与人工调整的审计依据。 */
export const creditLedger = dbSchema.table(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "opening_balance",
        "grant",
        "charge",
        "refund",
        "adjustment",
      ],
    }).notNull(),
    amountMicros: bigint("amount_micros", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    referenceId: text("reference_id").notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("credit_ledger_idempotency_key_uq").on(table.idempotencyKey),
    index("credit_ledger_user_created_idx").on(table.userId, table.createdAt),
  ]
)

export type BillingPriceRates = Array<{
  unit: string
  decimalPrice: string
  perUnits: number
}>

/** 每轮生成冻结的定价、汇率与用户扣额政策，不随之后的配置修改而变化。 */
export const billingPriceSnapshots = dbSchema.table(
  "billing_price_snapshots",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id").notNull(),
    providerId: text("provider_id").notNull(),
    serviceId: text("service_id").notNull(),
    currency: text("currency", { enum: ["CNY", "USD"] }).notNull(),
    rates: jsonb("rates").$type<BillingPriceRates>().notNull(),
    fxToCny: text("fx_to_cny").notNull(),
    chargingPolicyVersion: text("charging_policy_version").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_price_snapshots_generation_uq").on(
      table.generationId
    ),
  ]
)

/** 生成启动前的额度占用；只在短事务内创建或改变状态。 */
export const billingReservations = dbSchema.table(
  "billing_reservations",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    priceSnapshotId: text("price_snapshot_id")
      .notNull()
      .references(() => billingPriceSnapshots.id),
    customerReservedMicros: bigint("customer_reserved_micros", {
      mode: "number",
    }).notNull(),
    supplierReservedMicros: bigint("supplier_reserved_micros", {
      mode: "number",
    }).notNull(),
    customerChargedMicros: bigint("customer_charged_micros", {
      mode: "number",
    }),
    supplierCostMicros: bigint("supplier_cost_micros", { mode: "number" }),
    status: text("status", {
      enum: ["held", "settled", "released", "reconciliation_required"],
    })
      .notNull()
      .default("held"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_reservations_generation_uq").on(table.generationId),
    index("billing_reservations_user_status_idx").on(
      table.userId,
      table.status
    ),
    index("billing_reservations_status_expires_idx").on(
      table.status,
      table.expiresAt
    ),
  ]
)

/** 一次真实供应商调用的一种互斥计量单位。 */
export const billingUsageLines = dbSchema.table(
  "billing_usage_lines",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id").notNull(),
    operationId: text("operation_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    providerRequestId: text("provider_request_id"),
    kind: text("kind", { enum: ["llm", "search", "fetch"] }).notNull(),
    unit: text("unit", {
      enum: [
        "uncached_input_token",
        "cached_input_token",
        "cache_write_token",
        "output_token",
        "request",
        "page",
        "credit",
      ],
    }).notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    providerCostMicros: bigint("provider_cost_micros", { mode: "number" }),
    userChargeMicros: bigint("user_charge_micros", { mode: "number" }),
    evidence: text("evidence", {
      enum: ["reported", "estimated", "unknown"],
    }).notNull(),
    pricingSnapshotId: text("pricing_snapshot_id")
      .notNull()
      .references(() => billingPriceSnapshots.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_usage_lines_attempt_unit_price_uq").on(
      table.attemptId,
      table.unit,
      table.pricingSnapshotId
    ),
    index("billing_usage_lines_generation_idx").on(table.generationId),
  ]
)
