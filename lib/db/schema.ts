import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  integer,
  vector,
} from "drizzle-orm/pg-core"
import { EMBEDDING_DIMENSIONS } from "@/constants/rag"

export const threads = pgTable("threads", {
  id: text("id").primaryKey(), // == RemoteThreadMetadata.remoteId; reused as-is from the client-generated local thread id
  title: text("title"),
  status: text("status", { enum: ["regular", "archived"] })
    .notNull()
    .default("regular"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
})

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(), // == AI SDK UIMessage.id
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    parentId: text("parent_id"), // assistant-ui's message repository chain, used to rebuild branches
    role: text("role").notNull(), // denormalized from content.role for cheap filtering
    format: text("format").notNull().default("ai-sdk/v6"), // MessageStorageEntry.format
    content: jsonb("content").notNull(), // full UIMessage minus id: {role, parts, metadata?} - incl. tool-call parts
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("messages_thread_id_idx").on(table.threadId)]
)

export const attachments = pgTable("attachments", {
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
export const branchTrees = pgTable("branch_trees", {
  id: text("id").primaryKey(), // 客户端生成的 treeId（UUID，URL 路径段承载）
  title: text("title"), // 可空：取 main 首条 user 文本前若干字，纯展示（机器派生轨）
  // 双轨标题（design D1）：用户重命名只写这列（PATCH），防抖整树 PUT 只写上面的派生
  // title——两条写路径互不踩踏；对外展示一律 coalesce(custom_title, title)。
  customTitle: text("custom_title"),
  state: jsonb("state").notNull(), // 完整 ThreadTreeState
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// RAG 向量索引：超大文档改走检索而非全文注入时，存分块及其 embedding。
export const attachmentChunks = pgTable(
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
