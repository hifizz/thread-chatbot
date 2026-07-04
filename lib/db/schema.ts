import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core"

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
