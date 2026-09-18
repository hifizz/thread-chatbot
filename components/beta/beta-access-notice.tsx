import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ROUTES } from "@/constants/routes"

export function BetaAccessNotice({ suspended }: { suspended: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border bg-card p-8 text-center shadow-sm sm:p-12">
        <p className="text-sm font-medium text-muted-foreground">ThreadChat Private Beta</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {suspended ? "账号访问已暂停" : "私测资格尚未激活"}
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          {suspended
            ? "该账号暂时不能发起新任务。如需复核，请联系支持人员。"
            : "你仍可登录和管理账号；收到邀请后，请使用同一已验证邮箱完成激活。"}
        </p>
        {!suspended ? (
          <Button className="mt-8" render={<Link href={ROUTES.beta} />}>
            申请私测资格
          </Button>
        ) : null}
      </section>
    </main>
  )
}
