import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeftIcon } from "lucide-react"
import { getSession } from "@/lib/auth/server"
import { getAccountData } from "@/lib/billing/account"
import {
  TOPUP_PACKS,
  isTopupPackAvailable,
  subscriptionPlanName,
} from "@/constants/creem"
import { isCreemConfigured } from "@/lib/payments/creem"
import { formatYuan } from "@/constants/pricing"
import { getChatModel } from "@/constants/model"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TopupPacks } from "@/components/account/topup-packs"
import { TopupResultToast } from "@/components/account/topup-result-toast"

const PAYMENT_STATUS: Record<string, string> = {
  paid: "已到账",
  pending: "处理中",
  failed: "失败",
  refunded: "已退款",
}

const SUB_STATUS: Record<string, string> = {
  active: "生效中",
  trialing: "试用中",
  canceled: "已取消",
  past_due: "逾期",
  expired: "已过期",
  paused: "已暂停",
}

function fmtTime(iso: string | null): string {
  return iso ? format(new Date(iso), "yyyy-MM-dd HH:mm") : "—"
}

export default async function AccountPage() {
  const session = await getSession()
  if (!session) redirect("/sign-in?redirect=/account")

  const data = await getAccountData(session.user.id)
  const creemConfigured = isCreemConfigured()

  const packs = TOPUP_PACKS.map((p) => ({
    id: p.id,
    name: p.name,
    priceLabel: p.priceLabel,
    creditLabel: `${formatYuan(p.creditMicros, 0)} 额度`,
    bonusLabel: p.bonusLabel,
    available: isTopupPackAvailable(p),
  }))

  return (
    <div className="min-h-svh w-full bg-background">
      <Suspense>
        <TopupResultToast />
      </Suspense>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        {/* 顶部 */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            // 渲染成链接（<a>）而非原生 <button>，需关掉 nativeButton 以符合 Base UI 语义
            nativeButton={false}
            render={<Link href="/" aria-label="返回对话" />}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">账户与计费</h1>
            <p className="text-sm text-muted-foreground">
              {session.user.name || session.user.email}
            </p>
          </div>
        </div>

        {/* 余额 */}
        <Card>
          <CardHeader>
            <CardDescription>当前余额</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatYuan(data.balanceMicros, 2)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm text-muted-foreground tabular-nums">
              <span>累计充值 {formatYuan(data.totalToppedUpMicros, 2)}</span>
              <span>累计消耗 {formatYuan(data.totalSpentMicros, 2)}</span>
            </div>
          </CardContent>
        </Card>

        {/* 充值 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">充值</CardTitle>
            <CardDescription>
              选择充值包，通过 Creem 安全支付，到账后自动增加余额。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TopupPacks packs={packs} creemConfigured={creemConfigured} />
          </CardContent>
        </Card>

        {/* 订阅 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">订阅</CardTitle>
          </CardHeader>
          <CardContent>
            {data.subscription ? (
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {subscriptionPlanName(data.subscription.productId) ??
                      "订阅计划"}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {SUB_STATUS[data.subscription.status] ??
                      data.subscription.status}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  当前周期至 {fmtTime(data.subscription.currentPeriodEnd)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无订阅。</p>
            )}
          </CardContent>
        </Card>

        {/* 充值记录 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">充值记录</CardTitle>
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无充值记录。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border/60 text-left">
                      <th className="py-2 font-normal">时间</th>
                      <th className="py-2 font-normal">类型</th>
                      <th className="py-2 font-normal">金额</th>
                      <th className="py-2 text-right font-normal">到账额度</th>
                      <th className="py-2 text-right font-normal">状态</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.payments.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="py-2">
                          {fmtTime(p.paidAt ?? p.createdAt)}
                        </td>
                        <td className="py-2">
                          {p.type === "topup" ? "充值" : "订阅"}
                        </td>
                        <td className="py-2">{p.priceLabel ?? "—"}</td>
                        <td className="py-2 text-right">
                          {formatYuan(p.creditMicros, 2)}
                        </td>
                        <td className="py-2 text-right">
                          {PAYMENT_STATUS[p.status] ?? p.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 消耗记录 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">消耗记录</CardTitle>
            <CardDescription>最近 20 条按 token 计费的调用。</CardDescription>
          </CardHeader>
          <CardContent>
            {data.usage.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无消耗记录。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border/60 text-left">
                      <th className="py-2 font-normal">时间</th>
                      <th className="py-2 font-normal">模型</th>
                      <th className="py-2 text-right font-normal">输入</th>
                      <th className="py-2 text-right font-normal">输出</th>
                      <th className="py-2 text-right font-normal">费用</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.usage.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="py-2">{fmtTime(u.createdAt)}</td>
                        <td className="py-2">
                          {getChatModel(u.model)?.name ?? u.model}
                        </td>
                        <td className="py-2 text-right">{u.inputTokens}</td>
                        <td className="py-2 text-right">{u.outputTokens}</td>
                        <td className="py-2 text-right">
                          {formatYuan(u.priceMicros, 4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 法务链接 */}
        <div className="flex justify-center gap-4 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            服务条款
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            隐私政策
          </Link>
          <Link href="/refund" className="hover:text-foreground">
            退款政策
          </Link>
        </div>
      </div>
    </div>
  )
}
