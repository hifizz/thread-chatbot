import { NextResponse } from "next/server"
import { AdminAccessError, requireAdmin } from "@/lib/admin/auth"
import {
  getCohortRetention,
  getServiceMetrics,
  resolveMetricsRange,
} from "@/lib/admin/metrics"
import { METRIC_TIMEZONE } from "@/constants/analytics"

function error(status: number) {
  return NextResponse.json(
    { code: "METRICS_UNAVAILABLE" },
    { status, headers: { "Cache-Control": "private, no-store" } }
  )
}

/**
 * 运营指标聚合：UTC 桶、固定口径、仅服务端事实。
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD（缺省最近 14 天，最大 ADMIN_METRICS_MAX_DAYS）。
 * 不返回任意 SQL、原始内容或可识别个人的逐条记录。
 */
export async function GET(request: Request) {
  try {
    await requireAdmin()
  } catch (cause) {
    if (cause instanceof AdminAccessError) return error(cause.status)
    throw cause
  }
  const url = new URL(request.url)
  const range = resolveMetricsRange({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  })
  if (!range) return error(400)

  const [metrics, retention] = await Promise.all([
    getServiceMetrics(range),
    getCohortRetention({}),
  ])
  return NextResponse.json(
    { metrics, retention, timezone: METRIC_TIMEZONE },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}
