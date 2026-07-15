"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleUserRound, LogOut } from "lucide-react"
import { signOut, useSession } from "@/lib/auth/client"

/**
 * thread-chat 顶栏的账户入口（沿用顶栏 .tbtn 样式）：
 * · 未登录 → 「登录」按钮，跳 /sign-in 并带上回跳地址；
 * · 已登录 → 账户按钮（点进 /account）+ 登出按钮。
 * 顶栏本被中间件保护（未登录会被弹去登录页），登录态入口仍作兜底与可发现性保留。
 */
export function AccountButton() {
  const router = useRouter()
  const { data: session, isPending } = useSession()

  // 会话状态未定时不占位，避免闪烁
  if (isPending) return null

  if (!session) {
    const from =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/thread-chat"
    return (
      <Link
        className="tbtn"
        href={`/sign-in?redirect=${encodeURIComponent(from)}`}
        title="登录以使用对话"
      >
        <CircleUserRound size={13} />
        登录
      </Link>
    )
  }

  const { name, email } = session.user
  const label = name || email

  async function handleSignOut() {
    await signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <>
      <Link className="tbtn" href="/account" title={`${email}（账户与充值）`}>
        <CircleUserRound size={13} />
        <span className="acct-label">{label}</span>
      </Link>
      <button className="tbtn" title="登出" onClick={handleSignOut}>
        <LogOut size={13} />
      </button>
    </>
  )
}
