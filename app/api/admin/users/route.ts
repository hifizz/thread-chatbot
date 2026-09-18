import { NextResponse } from "next/server"
import { AdminAccessError, requireAdmin } from "@/lib/admin/auth"
import { listAdminUsers } from "@/lib/admin/metrics"
import { ADMIN_USER_SEARCH_MAX_LIMIT } from "@/constants/analytics"

function error(status: number) {
  return NextResponse.json(
    { code: "ADMIN_USERS_UNAVAILABLE" },
    { status, headers: { "Cache-Control": "private, no-store" } }
  )
}

/** 运营用户列表：分页上限 ADMIN_USER_SEARCH_MAX_LIMIT，按最近活动排序。 */
export async function GET(request: Request) {
  try {
    await requireAdmin()
  } catch (cause) {
    if (cause instanceof AdminAccessError) return error(cause.status)
    throw cause
  }
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get("limit") ?? "20")
  const offset = Number(url.searchParams.get("offset") ?? "0")
  if (!Number.isFinite(limit) || !Number.isFinite(offset) || limit < 1 || offset < 0) {
    return error(400)
  }
  const result = await listAdminUsers({
    limit: Math.min(limit, ADMIN_USER_SEARCH_MAX_LIMIT),
    offset,
  })
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  })
}
