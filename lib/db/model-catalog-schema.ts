import { boolean, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core"
import { dbSchema } from "./pg-schema"
import { user } from "./auth-schema"
import type { ModelCatalogConfig } from "@/lib/model-catalog/schema"

export const adminMembers = dbSchema.table("admin_members", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
export const modelCatalog = dbSchema.table("model_catalog", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  config: jsonb("config").$type<ModelCatalogConfig>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
})
export const modelCatalogSettings = dbSchema.table("model_catalog_settings", {
  id: text("id").primaryKey(),
  defaultModelId: text("default_model_id").notNull().references(() => modelCatalog.id),
  version: integer("version").notNull().default(1),
})
export const modelCatalogAudit = dbSchema.table("model_catalog_audit", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  targetId: text("target_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
