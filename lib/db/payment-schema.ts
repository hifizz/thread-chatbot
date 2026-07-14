import {
  text,
  timestamp,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { dbSchema } from "./pg-schema"
import { user } from "./auth-schema"

// 支付/订阅相关表。金额一律用「微元」整数（1 元 = 1_000_000 微元）。

// 充值/一次性订单流水。以 (provider, orderId) 唯一保证 webhook 重放时幂等，只到账一次。
export const payments = dbSchema.table(
  "payments",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("creem"),
    // 业务类型：充值 / 订阅首付款等
    type: text("type", { enum: ["topup", "subscription"] }).notNull(),
    packId: text("pack_id"), // 充值包 id（constants/creem.ts）
    productId: text("product_id"), // Creem 产品 id
    checkoutId: text("checkout_id"), // Creem checkout id
    orderId: text("order_id"), // Creem 订单 id（成功后才有），幂等键
    status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
      .notNull()
      .default("pending"),
    creditMicros: bigint("credit_micros", { mode: "number" })
      .notNull()
      .default(0), // 到账额度
    priceLabel: text("price_label"), // 展示价快照
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    raw: jsonb("raw"), // 原始 webhook/checkout 负载，便于对账排障
  },
  (table) => [
    index("payments_user_id_idx").on(table.userId),
    uniqueIndex("payments_provider_order_id_uq").on(
      table.provider,
      table.orderId
    ),
  ]
)

// 订阅状态镜像（以 Creem 为准，webhook 同步）。一个用户可有多条历史订阅，以 subscriptionId 唯一。
export const subscriptions = dbSchema.table(
  "subscriptions",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("creem"),
    subscriptionId: text("subscription_id").notNull().unique(), // Creem 订阅 id
    productId: text("product_id"),
    status: text("status").notNull(), // active / canceled / past_due / expired / trialing ...
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    raw: jsonb("raw"),
  },
  (table) => [index("subscriptions_user_id_idx").on(table.userId)]
)
