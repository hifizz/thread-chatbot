import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/server"
import { ROUTES, signInWithRedirect } from "@/constants/routes"

// 旗舰访问门禁：一处服务端 layout 同时包住 /thread-chat 跳板与 /thread-chat/[treeId]，
// 用「真会话」判定（getSession），未登录即 302 到带回跳的登录页。
// 用 server layout 而非 middleware：项目已主动撤除 middleware，且 better-auth 在 edge
// 只建议查 cookie 存在性（非真校验）；server layout 与 /account 页同构、做真会话校验，
// 未登录者本就没有属于自己的树，跳裸 /thread-chat 登录后生成新树即可。
export default async function ThreadChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect(signInWithRedirect(ROUTES.flagship))
  return <>{children}</>
}
