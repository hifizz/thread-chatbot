import { NextResponse } from "next/server"
import { AdminAccessError, requireAdmin } from "@/lib/admin/auth"
import { getUserActivitySummary } from "@/lib/admin/metrics"

function error(code: string, status: number) {
  return NextResponse.json(
    { code },
    { status, headers: { "Cache-Control": "private, no-store" } }
  )
}

/** 单用户运营视图：账号、用量、账务与反馈摘要，不含消息内容。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin()
  } catch (cause) {
    if (cause instanceof AdminAccessError)
      return error("AUTH_REQUIRED", cause.status)
    throw cause
  }
  const { userId } = await context.params
  const summary = await getUserActivitySummary({ userId })
  if (!summary) return error("NOT_FOUND", 404)
  return NextResponse.json(
    { user: summary },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}
