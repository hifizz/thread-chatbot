"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleUserRound } from "lucide-react"
import { signOut, useSession } from "@/lib/auth/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

/**
 * thread-chat 顶栏的账户入口：
 * · 未登录 → 「登录」按钮，跳 /sign-in 并带上回跳地址；
 * · 已登录 → 右上角只放一个头像（无头像用姓名首字母的默认头像），
 *   点击展开下拉：用户名（含邮箱副行）/ 个人资料（→ 账户页）/ 退出登录。
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

  const { name, email, image } = session.user
  const label = name || email
  const initial = (label?.[0] ?? "?").toUpperCase()

  async function handleSignOut() {
    await signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={label}
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Avatar size="sm">
          {image ? <AvatarImage src={image} alt={label} /> : null}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{label}</span>
          {name && email ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/account" />}>
          个人资料
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
