import {
  boolean,
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { user } from "./auth-schema"
import { dbSchema } from "./pg-schema"

export const privacyConsents = dbSchema.table(
  "privacy_consents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceIdHash: text("device_id_hash").notNull(),
    policyVersion: text("policy_version").notNull(),
    decision: text("decision", { enum: ["accepted", "rejected"] }).notNull(),
    analytics: boolean("analytics").notNull(),
    revision: integer("revision").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("privacy_consents_user_device_uq").on(
      table.userId,
      table.deviceIdHash
    ),
    index("privacy_consents_expiry_idx").on(table.expiresAt),
    check("privacy_consents_revision_positive", sql`${table.revision} >= 1`),
    check(
      "privacy_consents_decision_matches_analytics",
      sql`(${table.decision} = 'accepted' and ${table.analytics} = true) or (${table.decision} = 'rejected' and ${table.analytics} = false)`
    ),
  ]
)

export const privacyDataRequests = dbSchema.table(
  "privacy_data_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["export", "delete"] }).notNull(),
    status: text("status", {
      enum: ["requested", "verified", "processing", "completed", "rejected"],
    })
      .notNull()
      .default("requested"),
    verificationMethod: text("verification_method"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("privacy_data_requests_user_requested_idx").on(
      table.userId,
      table.requestedAt
    ),
    index("privacy_data_requests_status_idx").on(table.status, table.requestedAt),
    uniqueIndex("privacy_data_requests_one_active_uq")
      .on(table.userId, table.kind)
      .where(sql`${table.status} in ('requested', 'verified', 'processing')`),
  ]
)
