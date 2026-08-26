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
import { user } from "./auth-schema"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type {
  ArtifactKind,
  MessageFeedback as ConversationMessageFeedback,
} from "@/lib/thread-chat/contracts/dto"
import type { ConversationMessageStatus } from "@/lib/thread-chat/domain/conversation"

// 认证与计费表在独立文件中定义，这里统一 re-export，使 drizzle 客户端与迁移能感知它们。
export * from "./auth-schema"
export * from "./billing-schema"
export * from "./payment-schema"

export const attachments = dbSchema.table(
  "attachments",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()；同时是应用内 URL /api/attachments/{id} 的路径段
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(), // R2 对象 key：attachments/{uuid}.{白名单扩展名}，不含用户文件名
    filename: text("filename").notNull(), // 原始文件名，仅展示用
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(), // 字节；ingest 时与 R2 实际大小复验
    kind: text("kind", {
      enum: ["document", "image", "archive", "video"],
    }).notNull(),
    status: text("status", { enum: ["uploading", "ready", "failed"] })
      .notNull()
      .default("uploading"),
    pageCount: integer("page_count"), // PDF 专用
    pages: jsonb("pages").$type<string[]>(), // PDF 专用：pages[i] = 第 i+1 页文本，按页存储为二期 RAG/引用跳转铺路
    summary: text("summary"), // PDF 专用：上传后生成的内容摘要（冷启动引导）
    suggestedQuestions: jsonb("suggested_questions").$type<string[]>(), // PDF 专用：建议问题
    error: text("error"), // 失败原因（用户可见）
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

/** Message 产生的长期产物；通过 Project + source Message 做所有权与溯源。 */
export const artifacts = dbSchema.table(
  "artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
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

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(user, { fields: [projects.userId], references: [user.id] }),
  threads: many(threads),
  messages: many(messages),
  artifacts: many(artifacts),
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
  sourceMessage: one(messages, {
    fields: [artifacts.sourceMessageId],
    references: [messages.id],
  }),
}))

// RAG 向量索引：超大文档改走检索而非全文注入时，存分块及其 embedding。
export const attachmentChunks = dbSchema.table(
  "attachment_chunks",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    page: integer("page").notNull(), // 1-based 页码，支持带页码的引用溯源
    content: text("content").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
  },
  (table) => [
    index("attachment_chunks_attachment_id_idx").on(table.attachmentId),
    // HNSW + cosine 距离，用于近似最近邻检索
    index("attachment_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
)
