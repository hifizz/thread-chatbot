import type { Metadata } from "next"
import Link from "next/link"
import { WaitlistForm } from "@/components/beta/waitlist-form"
import { ROUTES } from "@/constants/routes"

export const metadata: Metadata = {
  title: "ThreadChat 私测申请",
  description: "申请 ThreadChat Private Beta 访问资格。",
}

export default function BetaWaitlistPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border bg-card p-8 shadow-sm sm:p-12">
        <p className="text-sm font-medium text-muted-foreground">ThreadChat Private Beta</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">加入私测候选名单</h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          我们会分批审核申请。获批后，你需要用受邀邮箱登录并主动激活；打开邮件链接本身不会消耗邀请。
        </p>
        <WaitlistForm />
        <p className="mt-8 text-sm text-muted-foreground">
          已有邀请？ <Link className="underline underline-offset-4" href={ROUTES.signIn}>登录账号</Link>
        </p>
      </section>
    </main>
  )
}
