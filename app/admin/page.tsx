import { requireAdminPage } from "@/lib/admin/auth"
import {
  getCohortRetention,
  getServiceMetrics,
  resolveMetricsRange,
  utcToday,
} from "@/lib/admin/metrics"
import { getTranslator } from "@/lib/i18n/server"
import { microsToYuan } from "@/constants/pricing"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

function yuan(micros: number): string {
  return `¥${microsToYuan(micros).toFixed(4)}`
}

function coverageVariant(
  coverage: "complete" | "estimated" | "partial" | "none"
): "default" | "secondary" | "destructive" | "outline" {
  switch (coverage) {
    case "complete":
      return "default"
    case "estimated":
      return "secondary"
    case "partial":
      return "destructive"
    default:
      return "outline"
  }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const t = await getTranslator()
  await requireAdminPage()

  const params = await searchParams
  const range = resolveMetricsRange({
    from: params.from,
    to: params.to,
  }) ?? { from: utcToday(), to: utcToday() }
  const [metrics, retention] = await Promise.all([
    getServiceMetrics(range),
    getCohortRetention({ cohortDays: 14 }),
  ])
  const today = metrics.days.at(-1)

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("ui.adminOverview")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("admin.metrics.asOf")}: {metrics.asOf} ·{" "}
          {t("admin.metrics.timezoneNote")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.dau")}</CardDescription>
            <CardTitle className="text-2xl">
              {today?.serviceActiveUsers ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t("admin.metrics.consented")}: {today?.analyticsConsentedUsers ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.health.running")}</CardDescription>
            <CardTitle className="text-2xl">
              {metrics.snapshot.runningGenerations}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t("admin.health.lease")}:{" "}
            {Math.round(metrics.snapshot.leaseMs / 1000)}s
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.health.stuck")}</CardDescription>
            <CardTitle className="text-2xl">
              {metrics.snapshot.stuckBeyondLease}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t("admin.health.stuckNote")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.health.outbox")}</CardDescription>
            <CardTitle className="text-2xl">
              {metrics.snapshot.pendingFeedbackOutbox}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t("admin.health.outboxNote")}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.metrics.daily")}</CardTitle>
          <CardDescription>
            {metrics.range.from} → {metrics.range.to} · {t("admin.metrics.note")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.metrics.date")}</TableHead>
                <TableHead className="text-end">{t("admin.dau")}</TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.consented")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.accepted")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.completed")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.failed")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.stopped")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.superseded")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.cost")}
                </TableHead>
                <TableHead className="text-end">
                  {t("admin.metrics.coverage")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...metrics.days].reverse().map((day) => (
                <TableRow key={day.date}>
                  <TableCell className="font-mono">{day.date}</TableCell>
                  <TableCell className="text-end">
                    {day.serviceActiveUsers}
                  </TableCell>
                  <TableCell className="text-end">
                    {day.analyticsConsentedUsers}
                  </TableCell>
                  <TableCell className="text-end">
                    {day.acceptedGenerations}
                  </TableCell>
                  <TableCell className="text-end">
                    {day.completedGenerations}
                  </TableCell>
                  <TableCell className="text-end">
                    {day.failedGenerations}
                  </TableCell>
                  <TableCell className="text-end">
                    {day.stoppedGenerations}
                  </TableCell>
                  <TableCell className="text-end">
                    {day.supersededGenerations}
                  </TableCell>
                  <TableCell className="text-end">
                    {yuan(day.providerCostMicros)}
                    {day.unknownCostAttempts > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({day.unknownCostAttempts}?)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Badge variant={coverageVariant(day.costCoverage)}>
                      {day.costCoverage}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableCaption>{metrics.consentNote}</TableCaption>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.metrics.latency")}</CardTitle>
            <CardDescription>{t("admin.metrics.latencyNote")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.metrics.scope")}</TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.samples")}
                  </TableHead>
                  <TableHead className="text-end">TTFT p50</TableHead>
                  <TableHead className="text-end">TTFT p95</TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.totalP50")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.totalP95")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.latency.map((row) => (
                  <TableRow key={row.scope}>
                    <TableCell className="font-mono">{row.scope}</TableCell>
                    <TableCell className="text-end">
                      {row.samples} ({row.ttftSamples})
                    </TableCell>
                    <TableCell className="text-end">
                      {row.ttftP50Ms === null ? "—" : `${row.ttftP50Ms}ms`}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.ttftP95Ms === null ? "—" : `${row.ttftP95Ms}ms`}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.totalP50Ms === null ? "—" : `${row.totalP50Ms}ms`}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.totalP95Ms === null ? "—" : `${row.totalP95Ms}ms`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.metrics.cohorts")}</CardTitle>
            <CardDescription>{t("admin.metrics.cohortNote")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.metrics.cohort")}</TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.registered")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.firstAnswer7d")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.activation7d")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.d1")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("admin.metrics.d7")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retention.cohorts.map((cohort) => (
                  <TableRow key={cohort.cohortDay}>
                    <TableCell className="font-mono">
                      {cohort.cohortDay}
                    </TableCell>
                    <TableCell className="text-end">
                      {cohort.registeredUsers}
                    </TableCell>
                    <TableCell className="text-end">
                      {cohort.firstAnswerWithin7d ??
                        t("admin.metrics.immature")}
                    </TableCell>
                    <TableCell className="text-end">
                      {cohort.activationWithin7d ?? t("admin.metrics.immature")}
                    </TableCell>
                    <TableCell className="text-end">
                      {cohort.retainedD1 ?? t("admin.metrics.immature")}
                    </TableCell>
                    <TableCell className="text-end">
                      {cohort.retainedD7 ?? t("admin.metrics.immature")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
