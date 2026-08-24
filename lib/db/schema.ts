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
  foreignKey,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { dbSchema } from "./pg-schema"
import { EMBEDDING_DIMENSIONS } from "@/constants/rag"
import { user } from "./auth-schema"
import type { MessageFeedback } from "@/lib/thread-chat/contracts/message-feedback"
import type {
  LifecycleStatus,
  GenerationIntent,
  GenerationStatus as CanonicalGenerationStatus,
  GenerationBillingStatus as CanonicalGenerationBillingStatus,
  MessageContent,
  MessageContentState,
  MessageRole,
  JsonValue,
} from "@/lib/thread-chat/domain/conversation-model"
import type {
  ConversationGenerationCheckpoint,
  KnownGenerationUsage,
  UsageCompleteness,
} from "@/lib/thread-chat/domain/conversation-generation"

// 认证与计费表在独立文件中定义，这里统一 re-export，使 drizzle 客户端与迁移能感知它们。
export * from "./auth-schema"
export * from "./billing-schema"
export * from "./payment-schema"

export const attachments = dbSchema.table("attachments", {
  id: text("id").primaryKey(), // crypto.randomUUID()；同时是应用内 URL /api/attachments/{id} 的路径段
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
})

// Issue #34 的规范 Conversation 写模型。Project → Conversation → Thread 是唯一
// 运行时权威；关系型约束的可延迟部分位于对应 Drizzle SQL migration 中。
export const workspaces = dbSchema.table(
  "workspaces",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull().default(0),
    lifecycle: text("lifecycle").$type<LifecycleStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("workspaces_lifecycle_idx").on(table.lifecycle)]
)

export const workspaceMembers = dbSchema.table(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "workspace_members_pk",
      columns: [table.workspaceId, table.userId],
    }),
    index("workspace_members_user_id_idx").on(table.userId),
  ]
)

export const projects = dbSchema.table(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    revision: integer("revision").notNull().default(0),
    lifecycle: text("lifecycle").$type<LifecycleStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_workspace_id_id_uq").on(table.workspaceId, table.id),
    index("projects_workspace_lifecycle_idx").on(
      table.workspaceId,
      table.lifecycle
    ),
  ]
)

export const conversations = dbSchema.table(
  "conversations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    rootThreadId: text("root_thread_id").notNull(),
    autoTitle: text("auto_title"),
    customTitle: text("custom_title"),
    revision: integer("revision").notNull().default(0),
    lifecycle: text("lifecycle").$type<LifecycleStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversations_project_id_id_uq").on(table.projectId, table.id),
    index("conversations_project_updated_idx").on(
      table.projectId,
      table.updatedAt
    ),
    index("conversations_project_lifecycle_idx").on(
      table.projectId,
      table.lifecycle
    ),
  ]
)

export const conversationThreads = dbSchema.table(
  "conversation_threads",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    localTitle: text("local_title"),
    revision: integer("revision").notNull().default(0),
    lifecycle: text("lifecycle").$type<LifecycleStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_threads_id_conversation_id_uq").on(
      table.id,
      table.conversationId
    ),
    index("conversation_threads_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
  ]
)

export const conversationTurns = dbSchema.table(
  "conversation_turns",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => conversationThreads.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    activeUserMessageId: text("active_user_message_id").notNull(),
    activeAssistantMessageId: text("active_assistant_message_id").notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_turns_id_thread_id_uq").on(
      table.id,
      table.threadId
    ),
    uniqueIndex("conversation_turns_thread_position_uq").on(
      table.threadId,
      table.position
    ),
    index("conversation_turns_active_user_idx").on(table.activeUserMessageId),
    index("conversation_turns_active_assistant_idx").on(
      table.activeAssistantMessageId
    ),
  ]
)

export const conversationMessages = dbSchema.table(
  "conversation_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
    role: text("role").$type<MessageRole>().notNull(),
    content: jsonb("content").$type<MessageContent>().notNull(),
    contentState: text("content_state").$type<MessageContentState>().notNull(),
    variantOfMessageId: text("variant_of_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_messages_id_thread_id_uq").on(
      table.id,
      table.threadId
    ),
    uniqueIndex("conversation_messages_id_thread_turn_uq").on(
      table.id,
      table.threadId,
      table.turnId
    ),
    index("conversation_messages_turn_created_idx").on(
      table.turnId,
      table.createdAt,
      table.id
    ),
    index("conversation_messages_variant_source_idx").on(
      table.variantOfMessageId
    ),
  ]
)

/** 规范 Message 所引用的 Artifact；来源使用稳定 Conversation/Thread/Message ID。 */
export const conversationArtifacts = dbSchema.table(
  "conversation_artifacts",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sourceThreadId: text("source_thread_id").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    lang: text("lang"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversation_artifacts_conversation_idx").on(
      table.conversationId,
      table.createdAt
    ),
    foreignKey({
      name: "conversation_artifacts_thread_fk",
      columns: [table.sourceThreadId, table.conversationId],
      foreignColumns: [
        conversationThreads.id,
        conversationThreads.conversationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_artifacts_message_fk",
      columns: [table.sourceMessageId, table.sourceThreadId],
      foreignColumns: [conversationMessages.id, conversationMessages.threadId],
    }).onDelete("cascade"),
  ]
)

export const conversationMessageFeedback = dbSchema.table(
  "conversation_message_feedback",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    messageId: text("message_id").notNull(),
    feedback: text("feedback").$type<MessageFeedback>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "conversation_message_feedback_pk",
      columns: [table.userId, table.conversationId, table.messageId],
    }),
    index("conversation_message_feedback_conversation_idx").on(
      table.userId,
      table.conversationId
    ),
    foreignKey({
      name: "conversation_message_feedback_thread_fk",
      columns: [table.threadId, table.conversationId],
      foreignColumns: [
        conversationThreads.id,
        conversationThreads.conversationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_message_feedback_message_fk",
      columns: [table.messageId, table.threadId],
      foreignColumns: [conversationMessages.id, conversationMessages.threadId],
    }).onDelete("cascade"),
  ]
)

export const threadForks = dbSchema.table(
  "thread_forks",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    parentThreadId: text("parent_thread_id").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    childThreadId: text("child_thread_id").notNull(),
    anchor: jsonb("anchor"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("thread_forks_child_thread_uq").on(table.childThreadId),
    index("thread_forks_parent_source_idx").on(
      table.parentThreadId,
      table.sourceMessageId
    ),
    index("thread_forks_conversation_created_idx").on(
      table.conversationId,
      table.createdAt
    ),
  ]
)

export const conversationGenerations = dbSchema.table(
  "conversation_generations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
    inputMessageId: text("input_message_id").notNull(),
    outputMessageId: text("output_message_id").notNull(),
    intent: jsonb("intent").$type<GenerationIntent>().notNull(),
    requestHash: text("request_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    modelId: text("model_id").notNull(),
    attempt: integer("attempt").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    status: text("status").$type<CanonicalGenerationStatus>().notNull(),
    contentState: text("content_state").$type<MessageContentState>().notNull(),
    checkpointVersion: integer("checkpoint_version").notNull().default(0),
    checkpoint: jsonb("checkpoint")
      .$type<ConversationGenerationCheckpoint>()
      .notNull(),
    knownUsage: jsonb("known_usage").$type<KnownGenerationUsage>(),
    usageCompleteness: text("usage_completeness")
      .$type<UsageCompleteness>()
      .notNull(),
    billingStatus: text("billing_status")
      .$type<CanonicalGenerationBillingStatus>()
      .notNull(),
    paidCallStarted: boolean("paid_call_started").notNull().default(false),
    leaseOwner: text("lease_owner"),
    leaseVersion: integer("lease_version").notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_generations_owner_idempotency_uq").on(
      table.ownerId,
      table.idempotencyKey
    ),
    uniqueIndex("conversation_generations_output_attempt_uq").on(
      table.outputMessageId,
      table.attempt
    ),
    uniqueIndex("conversation_generations_current_turn_uq")
      .on(table.turnId)
      .where(sql`${table.isCurrent} = true`),
    index("conversation_generations_owner_status_idx").on(
      table.ownerId,
      table.status
    ),
    index("conversation_generations_conversation_updated_idx").on(
      table.conversationId,
      table.updatedAt
    ),
    index("conversation_generations_lease_idx").on(
      table.status,
      table.heartbeatAt
    ),
  ]
)

export const conversationCommandRecords = dbSchema.table(
  "conversation_command_records",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    result: jsonb("result").$type<JsonValue>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_command_records_scope_key_uq").on(
      table.actorId,
      table.scopeType,
      table.scopeId,
      table.idempotencyKey
    ),
    index("conversation_command_records_actor_created_idx").on(
      table.actorId,
      table.createdAt
    ),
  ]
)

export const conversationOutboxEvents = dbSchema.table(
  "conversation_outbox_events",
  {
    id: text("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateRevision: integer("aggregate_revision").notNull(),
    type: text("type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedBy: text("claimed_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    index("conversation_outbox_events_pending_idx").on(
      table.status,
      table.availableAt,
      table.createdAt
    ),
    index("conversation_outbox_events_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateRevision
    ),
  ]
)

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
