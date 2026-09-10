import { eq } from "drizzle-orm"
import { notFound, redirect } from "next/navigation"
import { ADMIN_ROUTES } from "@/constants/admin"
import { signInWithRedirect } from "@/constants/routes"
import { getSession } from "@/lib/auth/server"
import { db } from "@/lib/db"
import { adminMembers } from "@/lib/db/admin-schema"

export class AdminAccessError extends Error {
  constructor(message: string, public readonly status: 401 | 403) {
    super(message)
    this.name = "AdminAccessError"
  }
}

/** 供后台数据读取和未来接口复用；每次在服务端检查当前成员记录。 */
export async function requireAdmin() {
  const session = await getSession()
  if (!session) throw new AdminAccessError("请先登录", 401)
  const [member] = await db.select({ userId: adminMembers.userId })
    .from(adminMembers).where(eq(adminMembers.userId, session.user.id))
  if (!member) throw new AdminAccessError("此页面仅限管理员访问", 403)
  return session.user
}

/** 页面入口统一处理登录跳转与无权限状态。 */
export async function requireAdminPage() {
  try { return await requireAdmin() } catch (error) {
    if (error instanceof AdminAccessError) {
      if (error.status === 401) redirect(signInWithRedirect(ADMIN_ROUTES.root))
      notFound()
    }
    throw error
  }
}
