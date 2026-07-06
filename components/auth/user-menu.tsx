"use client"

import { useRouter } from "next/navigation"
import { LogOutIcon } from "lucide-react"
import { signOut, useSession } from "@/lib/auth/client"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"

// 侧栏底部的账户信息 + 登出。collapsed 时只显示头像圈。
export function UserMenu({ collapsed }: { collapsed?: boolean }) {
  const router = useRouter()
  const { data: session, isPending } = useSession()

  if (isPending || !session) return null
  const { name, email } = session.user
  const label = name || email
  const initial = (label?.[0] ?? "?").toUpperCase()

  async function handleSignOut() {
    await signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <div
      className={cnRow(collapsed)}
      title={collapsed ? `${label}（点击登出）` : undefined}
      onClick={collapsed ? handleSignOut : undefined}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
        {initial}
      </div>
      {!collapsed && (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground/90">
            {label}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {email}
          </span>
        </div>
      )}
      {!collapsed && (
        <TooltipIconButton
          tooltip="登出"
          side="top"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={handleSignOut}
        >
          <LogOutIcon className="size-4" />
        </TooltipIconButton>
      )}
    </div>
  )
}

function cnRow(collapsed?: boolean) {
  return collapsed
    ? "flex items-center justify-center px-2 py-2 cursor-pointer"
    : "flex items-center gap-2 px-2 py-2"
}
