import { text, timestamp } from "drizzle-orm/pg-core"
import { dbSchema } from "./pg-schema"
import { user } from "./auth-schema"

/** 存在成员记录即具有 admin 角色；普通注册不会创建此记录。 */
export const adminMembers = dbSchema.table("admin_members", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
