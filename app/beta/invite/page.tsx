import type { Metadata } from "next"
import Link from "next/link"
import { InviteActivation } from "@/components/beta/invite-activation"
import { signInWithRedirect } from "@/constants/routes"
import { getSession } from "@/lib/auth/server"

export const metadata: Metadata = {
  title: "激活 ThreadChat 私测邀请",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function BetaInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token?.trim()
  const session = await getSession()
  const returnPath = token
    ? `/beta/invite?token=${encodeURIComponent(token)}`
    : "/beta/invite"

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border bg-card p-8 shadow-sm sm:p-12">
        <p className="text-sm font-medium text-muted-foreground">ThreadChat Private Beta</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">激活私测资格</h1>
        {!token ? (
          <p className="mt-4 text-muted-foreground">邀请链接不完整或已损坏，请使用邮件中的完整链接。</p>
        ) : !session ? (
          <div className="mt-6 space-y-4">
            <p className="text-muted-foreground">请先使用收到邀请的邮箱登录。登录不会自动消耗邀请。</p>
            <Link className="underline underline-offset-4" href={signInWithRedirect(returnPath)}>
              前往登录
            </Link>
          </div>
        ) : !session.user.emailVerified ? (
          <p className="mt-4 text-muted-foreground">请先完成邮箱验证，再返回此页面激活。</p>
        ) : (
          <>
            <p className="mt-4 leading-7 text-muted-foreground">
              当前登录邮箱：<span className="font-medium text-foreground">{session.user.email}</span>。只有与邀请一致的已验证邮箱才能激活。
            </p>
            <InviteActivation token={token} />
          </>
        )}
      </section>
    </main>
  )
}
