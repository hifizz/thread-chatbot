import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { getSession } from "@/lib/auth/server"
import { getAccountData } from "@/lib/billing/account"
import {
  TOPUP_PACKS,
  isTopupPackAvailable,
  subscriptionPlanName,
} from "@/constants/creem"
import { isCreemConfigured } from "@/lib/payments/creem"
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
import { getRequestLocale } from "@/lib/i18n/server"
import { createTranslator, formatCredit, formatTimestamp } from "@/lib/i18n/dictionary"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"


export default async function AccountPage() {
  const locale = await getRequestLocale()
  const t = createTranslator(locale)
  const fmtTime = (value: string | null) => formatTimestamp(locale, value)
  const formatYuan = (micros: number, digits = 2) => formatCredit(locale, micros, digits)
const PAYMENT_STATUS: Record<string, string> = {
  paid: t("ui.credited"),
  pending: t("ui.processing"),
  failed: t("ui.failed"),
  refunded: t("ui.refunded"),
}

const SUB_STATUS: Record<string, string> = {
  active: t("ui.active"),
  trialing: t("ui.trial"),
  canceled: t("ui.canceled"),
  past_due: t("ui.pastDue"),
  expired: t("ui.expired"),
  paused: t("ui.paused"),
}



  const session = await getSession()
  if (!session) redirect("/sign-in?redirect=/account")

  const data = await getAccountData(session.user.id)
  const creemConfigured = isCreemConfigured()

  const packs = TOPUP_PACKS.map((p) => ({
    id: p.id,
    name: p.name,
    priceLabel: p.priceLabel,
    creditLabel: t("billing.creditValue", { value: formatYuan(p.creditMicros, 0) }),
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
            render={<Link href="/" aria-label={t("ui.backToChat")} />}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{t("billing.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {session.user.name || session.user.email}
            </p>
          </div>
        </div>

        <LanguageSwitcher />

        {/* 余额 */}
        <Card>
          <CardHeader>
            <CardDescription>{t("billing.balance")}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatYuan(data.balanceMicros, 2)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm text-muted-foreground tabular-nums">
              <span>{t("ui.totalAdded")}{formatYuan(data.totalToppedUpMicros, 2)}</span>
              <span>{t("billing.used")}{formatYuan(data.totalSpentMicros, 2)}</span>
            </div>
          </CardContent>
        </Card>

        {/* 充值 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ui.topUp")}</CardTitle>
            <CardDescription>
              {t("ui.chooseACreditPackAndPay")}</CardDescription>
          </CardHeader>
          <CardContent>
            <TopupPacks packs={packs} creemConfigured={creemConfigured} />
          </CardContent>
        </Card>

        {/* 订阅 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ui.subscription")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.subscription ? (
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {subscriptionPlanName(data.subscription.productId) ??
                      t("ui.subscriptionPlan")}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {SUB_STATUS[data.subscription.status] ??
                      data.subscription.status}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("ui.currentPeriodEnds")}{fmtTime(data.subscription.currentPeriodEnd)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("ui.noSubscriptionYet")}</p>
            )}
          </CardContent>
        </Card>

        {/* 充值记录 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ui.paymentHistory")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ui.noPaymentsYet")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border/60 text-left">
                      <th className="py-2 font-normal">{t("common.time")}</th>
                      <th className="py-2 font-normal">{t("common.type")}</th>
                      <th className="py-2 font-normal">{t("common.amount")}</th>
                      <th className="py-2 text-right font-normal">{t("ui.creditAdded")}</th>
                      <th className="py-2 text-right font-normal">{t("common.status")}</th>
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
                          {p.type === "topup" ? t("ui.topUp") : t("ui.subscription")}
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
            <CardTitle className="text-base">{t("ui.usageHistory")}</CardTitle>
            <CardDescription>{t("ui.the20MostRecentTokenBilled")}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.usage.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ui.noUsageYet")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border/60 text-left">
                      <th className="py-2 font-normal">{t("common.time")}</th>
                      <th className="py-2 font-normal">{t("common.model")}</th>
                      <th className="py-2 text-right font-normal">{t("ui.input")}</th>
                      <th className="py-2 text-right font-normal">{t("ui.output")}</th>
                      <th className="py-2 text-right font-normal">{t("ui.cost")}</th>
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
            {t("common.terms")}</Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t("common.privacy")}</Link>
          <Link href="/refund" className="hover:text-foreground">
            {t("common.refund")}</Link>
        </div>
      </div>
    </div>
  )
}
