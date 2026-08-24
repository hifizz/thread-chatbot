import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/server"
import { ROUTES, signInWithRedirect } from "@/constants/routes"

// 旗舰访问门禁：一处服务端 layout 同时包住跳板与 Conversation 页面，
// 用「真会话」判定（getSession），未登录即 302 到带回跳的登录页。
// 用 server layout 而非 middleware：项目已主动撤除 middleware，且 better-auth 在 edge
// 只建议查 cookie 存在性（非真校验）；server layout 与 /account 页同构、做真会话校验，
// 未登录者没有可读的 Conversation，登录后由裸入口完成 canonical bootstrap。
export default async function ThreadChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect(signInWithRedirect(ROUTES.flagship))
  return <>{children}</>
}
