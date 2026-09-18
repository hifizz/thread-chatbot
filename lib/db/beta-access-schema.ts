import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { dbSchema } from "./pg-schema"
import { user } from "./auth-schema"

export const betaWaitlistEntries = dbSchema.table(
  "beta_waitlist_entries",
  {
    id: text("id").primaryKey(),
    emailNormalized: text("email_normalized").notNull(),
    locale: text("locale", { enum: ["zh-CN", "en"] }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "registered", "rejected", "withdrawn"],
    })
      .notNull()
      .default("pending"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    registeredUserId: text("registered_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("beta_waitlist_email_uq").on(table.emailNormalized),
    index("beta_waitlist_status_created_idx").on(table.status, table.createdAt),
  ]
)

export const betaInvites = dbSchema.table(
  "beta_invites",
  {
    id: text("id").primaryKey(),
    waitlistId: text("waitlist_id")
      .notNull()
      .references(() => betaWaitlistEntries.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("beta_invites_token_hash_uq").on(table.tokenHash),
    uniqueIndex("beta_invites_active_waitlist_uq")
      .on(table.waitlistId)
      .where(sql`${table.usedAt} is null and ${table.revokedAt} is null`),
    index("beta_invites_expires_idx").on(table.expiresAt),
  ]
)

export const userEntitlements = dbSchema.table("user_entitlements", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["beta", "pro"] }).notNull(),
  accountStatus: text("account_status", {
    enum: ["active", "suspended"],
  })
    .notNull()
    .default("active"),
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  grantSource: text("grant_source", {
    enum: ["beta-invite", "owner", "admin"],
  }).notNull(),
  grantedBy: text("granted_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** token 明文只存在加密 payload 中；投递完成或邀请失效后清空。 */
export const betaEmailOutbox = dbSchema.table(
  "beta_email_outbox",
  {
    id: text("id").primaryKey(),
    inviteId: text("invite_id")
      .notNull()
      .references(() => betaInvites.id, { onDelete: "cascade" }),
    encryptedPayload: text("encrypted_payload"),
    providerMessageId: text("provider_message_id"),
    status: text("status", {
      enum: [
        "queued",
        "sending",
        "sent",
        "delivered",
        "bounced",
        "complained",
        "failed",
      ],
    })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("beta_email_outbox_invite_uq").on(table.inviteId),
    uniqueIndex("beta_email_outbox_provider_message_uq").on(
      table.providerMessageId
    ),
    index("beta_email_outbox_status_retry_idx").on(
      table.status,
      table.nextAttemptAt
    ),
  ]
)

export const betaEmailEvents = dbSchema.table("beta_email_events", {
  eventId: text("event_id").primaryKey(),
  providerMessageId: text("provider_message_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const adminAuditLogs = dbSchema.table(
  "admin_audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    requestId: text("request_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_audit_actor_created_idx").on(table.actorId, table.createdAt),
    index("admin_audit_target_idx").on(table.targetType, table.targetId),
  ]
)

