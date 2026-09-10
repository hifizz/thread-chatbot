import { eq } from "drizzle-orm"
import { getSession } from "@/lib/auth/server"
import { db } from "@/lib/db"
import { adminMembers } from "@/lib/db/schema"
import { ModelCatalogError } from "@/lib/model-catalog/errors"

export async function requireAdmin() {
  const session = await getSession()
  if (!session) throw new ModelCatalogError("请先登录", 401)
  const [member] = await db.select().from(adminMembers).where(eq(adminMembers.userId, session.user.id))
  if (!member) throw new ModelCatalogError("此页面仅限管理员访问", 403)
  return session.user
}
