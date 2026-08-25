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
  bigint,
  check,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import type { UIMessage } from "ai"
import { dbSchema } from "./pg-schema"
import { EMBEDDING_DIMENSIONS } from "@/constants/rag"
import { user } from "./auth-schema"
import type {
  GenerationBillingStatus,
  GenerationResultV1,
  GenerationStatus,
  GenerationTurnSnapshot,
} from "@/lib/thread-chat/domain/generation"
import type { MessageFeedback } from "@/lib/thread-chat/domain/types"

// drizzle-kit 必须能从 schema 入口发现自定义 namespace；只导出其中的表会把
// thread_chat 误判为待删除 schema。
export { dbSchema } from "./pg-schema"

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

// 分支对话树（app/thread-chat）的整棵树持久化：一棵树一行，state 存完整
// ThreadTreeState（JSON）。与上面 assistant-ui 线性模型的 threads/messages 表分开，
// 互不复用——那两张表是线性会话，这张是树形分支态。treeId 由客户端生成
// （crypto.randomUUID()），URL 路径段承载（/thread-chat/{treeId}），URL 即树身份。
export const branchTrees = dbSchema.table(
  "branch_trees",
  {
    id: text("id").primaryKey(), // 客户端生成的 treeId（UUID，URL 路径段承载）
    // 迁移期允许历史树无主；新写入必须由 API 绑定当前 session user。
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    title: text("title"), // 可空：取 main 首条 user 文本前若干字，纯展示（机器派生轨）
    // 双轨标题（design D1）：用户重命名只写这列（PATCH），防抖整树 PUT 只写上面的派生
    // title——两条写路径互不踩踏；对外展示一律 coalesce(custom_title, title)。
    customTitle: text("custom_title"),
    state: jsonb("state").notNull(), // 完整 ThreadTreeState
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("branch_trees_user_id_idx").on(table.userId)]
)

/**
 * 每次 thread-chat assistant attempt 的服务端权威 sidecar。终态不直接改整树 JSON，
 * 读取时再把 current generation result 合并进去，避免旧浏览器快照覆盖最终答案。
 */
export const branchGenerations = dbSchema.table(
  "branch_generations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    treeId: text("tree_id")
      .notNull()
      .references(() => branchTrees.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    attempt: integer("attempt").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    status: text("status").$type<GenerationStatus>().notNull(),
    modelId: text("model_id").notNull(),
    assistantMessageIndex: integer("assistant_message_index").notNull(),
    turnSnapshot: jsonb("turn_snapshot")
      .$type<GenerationTurnSnapshot>()
      .notNull(),
    result: jsonb("result").$type<GenerationResultV1>(),
    error: text("error"),
    billingStatus: text("billing_status")
      .$type<GenerationBillingStatus>()
      .notNull()
      .default("pending"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("branch_generations_current_assistant_uq")
      .on(table.treeId, table.threadId, table.assistantMessageId)
      .where(sql`${table.isCurrent} = true`),
    uniqueIndex("branch_generations_assistant_attempt_uq").on(
      table.treeId,
      table.threadId,
      table.assistantMessageId,
      table.attempt
    ),
    index("branch_generations_user_id_idx").on(table.userId),
    index("branch_generations_tree_current_idx").on(
      table.treeId,
      table.isCurrent
    ),
    index("branch_generations_user_status_idx").on(table.userId, table.status),
    index("branch_generations_heartbeat_idx").on(
      table.status,
      table.heartbeatAt
    ),
  ]
)

/** 产品层 assistant message 的当前互斥反馈；不与 generation 执行身份耦合。 */
export const branchMessageFeedback = dbSchema.table(
  "branch_message_feedback",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    treeId: text("tree_id")
      .notNull()
      .references(() => branchTrees.id, { onDelete: "cascade" }),
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
      name: "branch_message_feedback_pk",
      columns: [table.userId, table.treeId, table.threadId, table.messageId],
    }),
    index("branch_message_feedback_tree_idx").on(table.userId, table.treeId),
  ]
)

/** Project 是一整簇 Root/Branch Thread 的 owner scope 与永久删除边界。 */
export const projects = dbSchema.table(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    autoTitle: text("auto_title"),
    customTitle: text("custom_title"),
    target: jsonb("target").$type<{
      ultimate: string | null
      shortTerm: string[]
      midTerm: string[]
    }>(),
    instruction: text("instruction"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    artifactChangeSequence: bigint("artifact_change_sequence", {
      mode: "number",
    })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("projects_owner_updated_idx").on(
      table.ownerUserId,
      table.updatedAt.desc(),
      table.id.desc()
    ),
    check(
      "projects_artifact_change_sequence_nonnegative_ck",
      sql`${table.artifactChangeSequence} >= 0`
    ),
  ]
)

/** Root/Branch 角色由 parent_thread_id 是否为空推导，不建立第二套实体类型。 */
export const threads = dbSchema.table(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentThreadId: uuid("parent_thread_id").references(
      (): AnyPgColumn => threads.id,
      { onDelete: "cascade" }
    ),
    // 同 Project、Parent/source 归属与无环关系无法由普通 CHECK 可靠表达，
    // 必须由后续 Repository 在事务内锁定并校验。
    sourceMessageId: uuid("source_message_id").references(
      (): AnyPgColumn => messages.id
    ),
    forkSourceSnapshot: jsonb("fork_source_snapshot").$type<{
      schemaVersion: 1
      quote?: string
      sourceRole: "user" | "assistant"
      sourceSequence: number
    }>(),
    baseContext: jsonb("base_context").$type<{
      schemaVersion: 1
      messageIds: string[]
    }>(),
    autoTitle: text("auto_title"),
    customTitle: text("custom_title"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("threads_one_root_per_project_uq")
      .on(table.projectId)
      .where(sql`${table.parentThreadId} is null`),
    index("threads_project_parent_idx").on(
      table.projectId,
      table.parentThreadId
    ),
    index("threads_source_message_idx").on(table.sourceMessageId),
    check(
      "threads_fork_facts_complete_ck",
      sql`(
        ${table.parentThreadId} is null
        and ${table.sourceMessageId} is null
        and ${table.forkSourceSnapshot} is null
        and ${table.baseContext} is null
      ) or (
        ${table.parentThreadId} is not null
        and ${table.sourceMessageId} is not null
        and ${table.forkSourceSnapshot} is not null
        and ${table.baseContext} is not null
      )`
    ),
  ]
)

/** Thread 内的稳定线性时间线；finalized 内容只能通过 replacement 演进。 */
export const messages = dbSchema.table(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    parts: jsonb("parts").$type<UIMessage["parts"] | null>(),
    // 同 Thread、同角色与来源状态属于跨行事务校验；数据库只保证来源存在且
    // 每条旧 Message 最多有一个直接 replacement。
    replacesMessageId: uuid("replaces_message_id").references(
      (): AnyPgColumn => messages.id
    ),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_thread_sequence_uq").on(
      table.threadId,
      table.sequence
    ),
    uniqueIndex("messages_single_replacement_uq")
      .on(table.replacesMessageId)
      .where(sql`${table.replacesMessageId} is not null`),
    index("messages_thread_active_sequence_idx")
      .on(table.threadId, table.sequence)
      .where(sql`${table.supersededAt} is null`),
    check("messages_sequence_positive_ck", sql`${table.sequence} > 0`),
    check("messages_role_ck", sql`${table.role} in ('user', 'assistant')`),
    check(
      "messages_not_self_replacement_ck",
      sql`${table.replacesMessageId} is null or ${table.replacesMessageId} <> ${table.id}`
    ),
  ]
)

/** 每条 assistant Message 恰有一条运行记录；user Message 的排除由 Repository 校验。 */
export const messageRuns = dbSchema.table(
  "message_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assistantMessageId: uuid("assistant_message_id")
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"queued" | "running" | "completed" | "failed" | "stopped">()
      .notNull()
      .default("queued"),
    modelId: text("model_id").notNull(),
    eventSequence: bigint("event_sequence", { mode: "number" })
      .notNull()
      .default(0),
    checkpointParts: jsonb("checkpoint_parts")
      .$type<UIMessage["parts"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("message_runs_status_heartbeat_idx").on(
      table.status,
      table.heartbeatAt
    ),
    check(
      "message_runs_status_ck",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'stopped')`
    ),
    check(
      "message_runs_event_sequence_nonnegative_ck",
      sql`${table.eventSequence} >= 0`
    ),
  ]
)

/** Artifact 内容独立持久化，Project 决定 owner scope，Message 保留 provenance。 */
export const artifacts = dbSchema.table(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // source Message 与 Artifact 的 Project 归属由 Repository 在同一事务复验。
    sourceMessageId: uuid("source_message_id")
      .notNull()
      .references(() => messages.id),
    changeSequence: bigint("change_sequence", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("artifacts_project_change_sequence_uq").on(
      table.projectId,
      table.changeSequence
    ),
    index("artifacts_project_kind_idx").on(table.projectId, table.kind),
    index("artifacts_source_message_idx").on(table.sourceMessageId),
    check(
      "artifacts_change_sequence_positive_ck",
      sql`${table.changeSequence} > 0`
    ),
  ]
)

/** assistant Message 的当前互斥反馈；null 由删除该行表达。 */
export const messageFeedback = dbSchema.table(
  "message_feedback",
  {
    assistantMessageId: uuid("assistant_message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    feedback: text("feedback").$type<"positive" | "negative">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "message_feedback_value_ck",
      sql`${table.feedback} in ('positive', 'negative')`
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
