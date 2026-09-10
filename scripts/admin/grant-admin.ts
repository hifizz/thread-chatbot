import { eq } from "drizzle-orm"
import { db } from "../../lib/db"
import { adminMembers, user } from "../../lib/db/schema"
const index = process.argv.indexOf("--email")
const email = index >= 0 ? process.argv[index + 1]?.trim().toLowerCase() : undefined
if (!email) throw new Error("用法：admin:grant --email 已注册邮箱")
const [account] = await db.select().from(user).where(eq(user.email, email))
if (!account) throw new Error("用户不存在，请先注册")
await db.insert(adminMembers).values({ userId: account.id }).onConflictDoNothing()
console.log("已授予指定用户管理员权限。")
process.exit(0)
