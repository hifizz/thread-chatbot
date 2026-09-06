import {
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  integer,
  boolean,
  vector,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { dbSchema } from "./pg-schema"
import { EMBEDDING_DIMENSIONS } from "@/constants/rag"
import {
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_TARGET_MAX_CHARS,
} from "@/constants/project-workspace"
import { user } from "./auth-schema"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type {
  ArtifactKind,
  MessageFeedback as ConversationMessageFeedback,
} from "@/lib/thread-chat/contracts/dto"
import type { ConversationMessageStatus } from "@/lib/thread-chat/domain/conversation"

// drizzle-kit 只扫描这个入口文件导出的对象；单纯 import 不会把自定义 PostgreSQL
// schema 暴露给 db:push。这里重新导出，避免 thread_chat 被误判为未声明的 schema。
export { dbSchema }

// 认证与计费表在独立文件中定义，这里统一 re-export，使 drizzle 客户端与迁移能感知它们。
export * from "./auth-schema"
export * from "./billing-schema"
export * from "./payment-schema"

/** 公开内容只在创建事务中写入；撤销只修改生命周期。 */
export const shares = dbSchema.table("shares", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceProjectId: text("source_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  resourceType: text("resource_type", { enum: ["project", "artifact"] }).notNull(),
  resourceId: text("resource_id").notNull(),
  snapshot: jsonb("snapshot").$type<import("@/lib/thread-chat/sharing/contracts").PublicSnapshot>().notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("shares_token_uq").on(table.token),
  index("shares_owner_resource_created_idx").on(table.ownerId, table.resourceType, table.resourceId, table.createdAt),
  index("shares_source_project_idx").on(table.sourceProjectId),
  check("shares_resource_type", sql`${table.resourceType} in ('project', 'artifact')`),
  check("shares_project_resource", sql`${table.resourceType} <> 'project' or ${table.resourceId} = ${table.sourceProjectId}`),
  check("shares_token_shape", sql`${table.token} ~ '^[A-Za-z0-9_-]{32}$'`),
  check("shares_schema_version", sql`${table.schemaVersion} = 1`),
  check("shares_expiry_after_creation", sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`),
  check("shares_revocation_after_creation", sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`),
])

export const attachments = dbSchema.table(
  "attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    kind: text("kind", {
      enum: ["document", "image", "archive", "video"],
    }).notNull(),
    status: text("status", { enum: ["uploading", "ready", "failed"] })
      .notNull()
      .default("uploading"),
    pageCount: integer("page_count"),
    pages: jsonb("pages").$type<string[]>(),
    summary: text("summary"),
    suggestedQuestions: jsonb("suggested_questions").$type<string[]>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("attachments_user_id_idx").on(table.userId)]
)

/** v1 规范化 ThreadChat Project；不保存整棵树 JSON。 */
export const projects = dbSchema.table(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    autoTitle: text("auto_title"),
    customTitle: text("custom_title"),
    target: text("target"),
    instructions: text("instructions"),
    contractVersion: integer("contract_version").notNull().default(0),
    nextFootnote: integer("next_footnote").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("projects_user_updated_idx").on(table.userId, table.updatedAt),
    index("projects_user_archived_updated_idx").on(
      table.userId,
      table.archivedAt,
      table.updatedAt
    ),
    check("projects_next_footnote_positive", sql`${table.nextFootnote} >= 1`),
    check(
      "projects_contract_version_nonnegative",
      sql`${table.contractVersion} >= 0`
    ),
    check(
      "projects_target_length",
      sql`${table.target} is null or char_length(${table.target}) <= ${sql.raw(String(PROJECT_TARGET_MAX_CHARS))}`
    ),
    check(
      "projects_instructions_length",
      sql`${table.instructions} is null or char_length(${table.instructions}) <= ${sql.raw(String(PROJECT_INSTRUCTIONS_MAX_CHARS))}`
    ),
  ]
)

/** Attachment 的 Project 资料区成员关系；底层文件仍由 attachments 作为唯一来源。 */
export const projectFiles = dbSchema.table(
  "project_files",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "project_files_pk",
      columns: [table.projectId, table.attachmentId],
    }),
    uniqueIndex("project_files_attachment_uq").on(table.attachmentId),
    index("project_files_project_added_idx").on(table.projectId, table.addedAt),
  ]
)

/** v1 规范化 Thread 节点；MainThread 与 ForkedThread 使用同一张表。 */
export const threads = dbSchema.table(
  "threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => threads.id, {
      onDelete: "cascade",
    }),
    forkMessageId: text("fork_message_id").references(
      (): AnyPgColumn => messages.id
    ),
    forkContext: jsonb("fork_context").$type<string[]>().notNull().default([]),
    forkAnchor: jsonb("fork_anchor").$type<TextAnchor>(),
    anchorText: text("anchor_text"),
    footnote: integer("footnote"),
    depth: integer("depth").notNull(),
    modelId: text("model_id").notNull(),
    autoTitle: text("auto_title"),
    customTitle: text("custom_title"),
    titleGenerationAttempted: boolean("title_generation_attempted")
      .notNull()
      .default(false),
    titleGenerated: boolean("title_generated").notNull().default(false),
    nextSequence: integer("next_sequence").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("threads_project_id_id_uq").on(table.projectId, table.id),
    uniqueIndex("threads_one_root_per_project_uq")
      .on(table.projectId)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("threads_project_footnote_uq")
      .on(table.projectId, table.footnote)
      .where(sql`${table.footnote} is not null`),
    index("threads_project_parent_idx").on(table.projectId, table.parentId),
    index("threads_project_fork_message_idx").on(
      table.projectId,
      table.forkMessageId
    ),
    check("threads_depth_nonnegative", sql`${table.depth} >= 0`),
    check("threads_next_sequence_positive", sql`${table.nextSequence} >= 1`),
    check(
      "threads_root_or_fork_shape",
      sql`(
        (${table.parentId} is null and ${table.depth} = 0 and
          ${table.forkMessageId} is null and ${table.forkAnchor} is null and
          ${table.anchorText} is null and ${table.footnote} is null and
          ${table.forkContext} = '[]'::jsonb)
        or
        (${table.parentId} is not null and ${table.depth} > 0 and
          ${table.forkMessageId} is not null and ${table.forkAnchor} is not null and
          ${table.anchorText} is not null and ${table.footnote} is not null and
          jsonb_array_length(${table.forkContext}) > 0)
      )`
    ),
  ]
)

/** v1 UI Message 行；每个 assistant 生成尝试对应独立记录。 */
export const messages = dbSchema.table(
  "messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    parts: jsonb("parts").$type<ThreadChatUIMessage["parts"]>().notNull(),
    status: text("status").$type<ConversationMessageStatus>().notNull(),
    modelId: text("model_id"),
    replacesMessageId: text("replaces_message_id").references(
      (): AnyPgColumn => messages.id
    ),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    feedback: text("feedback").$type<ConversationMessageFeedback>(),
    providerUsage: jsonb("provider_usage").$type<Record<string, unknown>>(),
    finishReason: text("finish_reason"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_thread_sequence_uq").on(
      table.threadId,
      table.sequence
    ),
    uniqueIndex("messages_project_thread_id_uq").on(
      table.projectId,
      table.threadId,
      table.id
    ),
    uniqueIndex("messages_project_id_uq").on(table.projectId, table.id),
    uniqueIndex("messages_replaces_message_uq")
      .on(table.replacesMessageId)
      .where(sql`${table.replacesMessageId} is not null`),
    index("messages_project_thread_sequence_idx").on(
      table.projectId,
      table.threadId,
      table.sequence
    ),
    index("messages_thread_timeline_idx").on(
      table.threadId,
      table.supersededAt,
      table.sequence
    ),
    check("messages_sequence_positive", sql`${table.sequence} >= 1`),
    check("messages_role_allowed", sql`${table.role} in ('user', 'assistant')`),
    check(
      "messages_status_allowed",
      sql`${table.status} in ('generating', 'completed', 'stopped', 'failed')`
    ),
    check(
      "messages_role_status_shape",
      sql`(
        (${table.role} = 'user' and ${table.status} = 'completed' and ${table.modelId} is null)
        or
        (${table.role} = 'assistant' and ${table.modelId} is not null)
      )`
    ),
    check(
      "messages_terminal_finished_shape",
      sql`(
        (${table.status} = 'generating' and ${table.finishedAt} is null)
        or
        (${table.status} <> 'generating' and ${table.finishedAt} is not null)
      )`
    ),
    check(
      "messages_feedback_allowed",
      sql`${table.feedback} is null or ${table.feedback} in ('up', 'down')`
    ),
  ]
)

/** Durable delivery state for the current product feedback Score. */
export const feedbackScoreOutbox = dbSchema.table(
  "feedback_score_outbox",
  {
    messageId: text("message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    value: text("value", { enum: ["up", "down", "cleared"] }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", {
      withTimezone: true,
    }).notNull(),
    version: integer("version").notNull().default(1),
    deliveredVersion: integer("delivered_version").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockToken: text("lock_token"),
    lastErrorCategory: text("last_error_category"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("feedback_score_outbox_due_idx").on(
      table.nextAttemptAt,
      table.lockedUntil
    ),
    check(
      "feedback_score_outbox_value_allowed",
      sql`${table.value} in ('up', 'down', 'cleared')`
    ),
    check("feedback_score_outbox_version_positive", sql`${table.version} >= 1`),
    check(
      "feedback_score_outbox_delivered_version_valid",
      sql`${table.deliveredVersion} >= 0 and ${table.deliveredVersion} <= ${table.version}`
    ),
    check(
      "feedback_score_outbox_attempts_nonnegative",
      sql`${table.attempts} >= 0`
    ),
    check(
      "feedback_score_outbox_lock_shape",
      sql`(${table.lockedUntil} is null) = (${table.lockToken} is null)`
    ),
  ]
)

/** Message 产生的长期产物；Project、Thread 与 source Message 都持久化用于溯源。 */
export const artifacts = dbSchema.table(
  "artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => messages.id),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    language: text("language"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("artifacts_project_created_idx").on(table.projectId, table.createdAt),
    index("artifacts_thread_created_idx").on(table.threadId, table.createdAt),
    index("artifacts_source_message_idx").on(table.sourceMessageId),
  ]
)

/** v1 创建/写命令的幂等收据；result 是提交后的权威 DTO。 */
export const conversationCommands = dbSchema.table(
  "conversation_commands",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    scopeId: text("scope_id").notNull(),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "conversation_commands_pk",
      columns: [table.userId, table.id],
    }),
    index("conversation_commands_scope_idx").on(table.userId, table.scopeId),
  ]
)

export const attachmentsRelations = relations(attachments, ({ many }) => ({
  projectMemberships: many(projectFiles),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(user, { fields: [projects.userId], references: [user.id] }),
  files: many(projectFiles),
  threads: many(threads),
  messages: many(messages),
  artifacts: many(artifacts),
}))

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.id],
  }),
  attachment: one(attachments, {
    fields: [projectFiles.attachmentId],
    references: [attachments.id],
  }),
}))

export const threadsRelations = relations(threads, ({ one, many }) => ({
  project: one(projects, {
    fields: [threads.projectId],
    references: [projects.id],
  }),
  parent: one(threads, {
    fields: [threads.parentId],
    references: [threads.id],
    relationName: "threadChildren",
  }),
  children: many(threads, { relationName: "threadChildren" }),
  messages: many(messages),
  artifacts: many(artifacts),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  project: one(projects, {
    fields: [messages.projectId],
    references: [projects.id],
  }),
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
  replacedMessage: one(messages, {
    fields: [messages.replacesMessageId],
    references: [messages.id],
    relationName: "messageReplacement",
  }),
  replacements: many(messages, { relationName: "messageReplacement" }),
  artifacts: many(artifacts),
}))

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  project: one(projects, {
    fields: [artifacts.projectId],
    references: [projects.id],
  }),
  thread: one(threads, {
    fields: [artifacts.threadId],
    references: [threads.id],
  }),
  sourceMessage: one(messages, {
    fields: [artifacts.sourceMessageId],
    references: [messages.id],
  }),
}))

// RAG 向量索引：超大文档改走检索而非全文注入时，存分块及其 embedding。
export const attachmentChunks = dbSchema.table(
  "attachment_chunks",
  {
    id: text("id").primaryKey(),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
  },
  (table) => [
    index("attachment_chunks_attachment_id_idx").on(table.attachmentId),
    index("attachment_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
)
