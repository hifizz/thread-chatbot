"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleUserRound } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut, useSession } from "@/lib/auth/client"

/** Thread Chat 原顶栏的账户入口。 */
export function AccountButton() {
  const router = useRouter()
  const { data: session, isPending } = useSession()

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
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate font-medium">{label}</span>
            {name && email ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {email}
              </span>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/account" />}>
          个人资料
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await signOut()
            router.push("/sign-in")
            router.refresh()
          }}
        >
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
