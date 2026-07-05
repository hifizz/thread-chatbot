import { pgTable, text, jsonb, timestamp, index, integer } from "drizzle-orm/pg-core"

export const threads = pgTable("threads", {
  id: text("id").primaryKey(), // == RemoteThreadMetadata.remoteId; reused as-is from the client-generated local thread id
  title: text("title"),
  status: text("status", { enum: ["regular", "archived"] })
    .notNull()
    .default("regular"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_thread_id_idx").on(table.threadId)],
)

export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(), // crypto.randomUUID()；同时是应用内 URL /api/attachments/{id} 的路径段
  key: text("key").notNull().unique(), // R2 对象 key：attachments/{uuid}.{白名单扩展名}，不含用户文件名
  filename: text("filename").notNull(), // 原始文件名，仅展示用
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(), // 字节；ingest 时与 R2 实际大小复验
  kind: text("kind", { enum: ["document", "image", "archive", "video"] }).notNull(),
  status: text("status", { enum: ["uploading", "ready", "failed"] })
    .notNull()
    .default("uploading"),
  pageCount: integer("page_count"), // PDF 专用
  pages: jsonb("pages").$type<string[]>(), // PDF 专用：pages[i] = 第 i+1 页文本，按页存储为二期 RAG/引用跳转铺路
  error: text("error"), // 失败原因（用户可见）
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
