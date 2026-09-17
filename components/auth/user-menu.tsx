"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOutIcon } from "lucide-react"
import { signOut, useSession } from "@/lib/auth/client"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { useI18n } from "@/lib/i18n/client"


// 侧栏底部的账户信息：点击进入账户/充值页；expanded 时额外显示登出按钮。
export function UserMenu({ collapsed }: { collapsed?: boolean }) {
  const { t } = useI18n()

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
      className={
        collapsed ? "flex justify-center py-1" : "flex items-center gap-2 px-1"
      }
    >
      <Link
        href="/account"
        title={collapsed ? t("common.accountFor", { name: label }) : t("ui.accountAndCredit")}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent"
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
      </Link>
      {!collapsed && (
        <TooltipIconButton
          tooltip={t("ui.signOut")}
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
