import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type {
  SkillActivationMode,
  SkillCapabilityProfileId,
  SkillSourceType,
} from "@/constants/skill"
import type { SkillResourceSnapshot } from "@/lib/skills/package-types"
import { dbSchema } from "./pg-schema"

/** 运行时 Skill 的逻辑身份；不保存用户选择历史。 */
export const skills = dbSchema.table(
  "skills",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    sourceType: text("source_type").$type<SkillSourceType>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("skills_slug_uq").on(table.slug),
    check(
      "skills_slug_shape",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`
    ),
    check(
      "skills_source_type_allowed",
      sql`${table.sourceType} in ('builtin', 'admin')`
    ),
  ]
)

/**
 * 已发布的 SkillVersion 是不可变内容快照。普通应用路径只会插入新版本、切换
 * isCurrent、撤销版本或启停逻辑 Skill，不提供更新正文/manifest/resources 的 API。
 */
export const skillVersions = dbSchema.table(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    digest: text("digest").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    instructions: text("instructions").notNull(),
    resources: jsonb("resources")
      .$type<SkillResourceSnapshot[]>()
      .notNull()
      .default([]),
    activationMode: text("activation_mode")
      .$type<SkillActivationMode>()
      .notNull(),
    capabilityProfileId: text("capability_profile_id")
      .$type<SkillCapabilityProfileId>()
      .notNull(),
    /** 安全 revision（如 builtin:<digest>），不得保存管理员绝对本地路径。 */
    sourceRevision: text("source_revision"),
    isCurrent: boolean("is_current").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("skill_versions_skill_digest_uq").on(
      table.skillId,
      table.digest
    ),
    uniqueIndex("skill_versions_skill_version_uq").on(
      table.skillId,
      table.version
    ),
    uniqueIndex("skill_versions_one_current_uq")
      .on(table.skillId)
      .where(sql`${table.isCurrent} = true`),
    index("skill_versions_digest_idx").on(table.digest),
    index("skill_versions_current_idx").on(table.isCurrent, table.revokedAt),
    check(
      "skill_versions_digest_shape",
      sql`${table.digest} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "skill_versions_activation_mode_allowed",
      sql`${table.activationMode} in ('sticky', 'one-shot')`
    ),
    check(
      "skill_versions_name_not_empty",
      sql`length(btrim(${table.name})) > 0`
    ),
    check(
      "skill_versions_description_not_empty",
      sql`length(btrim(${table.description})) > 0`
    ),
    check(
      "skill_versions_instructions_not_empty",
      sql`length(btrim(${table.instructions})) > 0`
    ),
    check(
      "skill_versions_capability_profile_not_empty",
      sql`length(btrim(${table.capabilityProfileId})) > 0`
    ),
  ]
)

export const skillsRelations = relations(skills, ({ many }) => ({
  versions: many(skillVersions),
}))

export const skillVersionsRelations = relations(skillVersions, ({ one }) => ({
  skill: one(skills, {
    fields: [skillVersions.skillId],
    references: [skills.id],
  }),
}))
