import Link from "next/link"
import { notFound } from "next/navigation"
import { requireAdminPage } from "@/lib/admin/auth"
import { getUserActivitySummary } from "@/lib/admin/metrics"
import { getTranslator } from "@/lib/i18n/server"
import { microsToYuan } from "@/constants/pricing"
import { ADMIN_ROUTES } from "@/constants/admin"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function yuan(micros: number | null): string {
  return micros === null ? "—" : `¥${microsToYuan(micros).toFixed(4)}`
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const t = await getTranslator()
  await requireAdminPage()

  const { userId } = await params
  const user = await getUserActivitySummary({ userId })
  if (!user) notFound()

  const fields: Array<{ label: string; value: React.ReactNode }> = [
    { label: t("admin.userDetail.name"), value: user.name },
    { label: t("admin.userDetail.email"), value: user.email },
    {
      label: t("admin.userDetail.emailVerified"),
      value: user.emailVerified ? t("ui.yes") : t("ui.no"),
    },
    { label: t("admin.userDetail.locale"), value: user.locale ?? "—" },
    {
      label: t("admin.userDetail.registered"),
      value: user.registeredAt.slice(0, 10),
    },
    {
      label: t("admin.userDetail.lastActive"),
      value: user.lastServiceActionAt?.slice(0, 10) ?? "—",
    },
    {
      label: t("admin.userDetail.consent"),
      value:
        user.analyticsConsent === "active"
          ? t("admin.userDetail.consentActive")
          : t("admin.userDetail.consentNone"),
    },
    { label: t("admin.userDetail.balance"), value: yuan(user.balanceMicros) },
    {
      label: t("admin.userDetail.providerCost"),
      value: yuan(user.providerCostMicros),
    },
    {
      label: t("admin.userDetail.customerCharge"),
      value: yuan(user.customerChargeMicros),
    },
    {
      label: t("admin.userDetail.unknownCost"),
      value: user.unknownCostAttempts,
    },
    {
      label: t("admin.userDetail.dataRequests"),
      value: user.openDataRequests,
    },
  ]

  const activity: Array<{ label: string; value: number }> = [
    { label: t("admin.metrics.accepted"), value: user.acceptedGenerations },
    { label: t("admin.metrics.completed"), value: user.completedGenerations },
    { label: t("admin.metrics.failed"), value: user.failedGenerations },
    { label: t("admin.metrics.stopped"), value: user.stoppedGenerations },
    { label: t("admin.health.running"), value: user.runningGenerations },
    { label: t("admin.userDetail.branches"), value: user.branchThreads },
    { label: t("admin.userDetail.artifacts"), value: user.artifactCount },
    { label: t("feedback.helpful"), value: user.feedbackUp },
    { label: t("feedback.unhelpful"), value: user.feedbackDown },
  ]

  return (
    <>
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={ADMIN_ROUTES.users} prefetch={false} />}
        >
          ← {t("admin.users")}
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("admin.userDetail.title")}
        </h1>
        {user.internalTestUser && (
          <Badge variant="secondary">{t("admin.userList.internal")}</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.userDetail.account")}</CardTitle>
          <CardDescription>{t("admin.userDetail.note")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((field) => (
              <div key={field.label}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="mt-0.5 text-sm font-medium">{field.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.userDetail.activity")}</CardTitle>
          <CardDescription>{t("admin.userDetail.activityNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            {activity.map((item) => (
              <div key={item.label}>
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="mt-0.5 text-sm font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  )
}
