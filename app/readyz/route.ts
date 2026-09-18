import { sql } from "drizzle-orm"
import {
  RUNTIME_READYZ_CACHE_MS,
  RUNTIME_READYZ_DB_TIMEOUT_MS,
} from "@/constants/runtime"
import { db } from "@/lib/db"
import { getInstanceId, getReleaseId } from "@/lib/runtime/instance"
import { drainState } from "@/lib/runtime/drain"

/**
 * Readiness：决定 Fly 是否继续把流量路由到本实例。
 * - drain 中 → 503，让代理摘除本实例（新请求不再进来，在途任务继续）；
 * - DB 不可达 → 503 degraded；
 * - 探测结果短缓存，避免健康检查放大成数据库压力。
 */

export const dynamic = "force-dynamic"

let cachedDbOk: { at: number; ok: boolean } | null = null

async function probeDatabase(): Promise<boolean> {
  const now = Date.now()
  if (cachedDbOk && now - cachedDbOk.at < RUNTIME_READYZ_CACHE_MS) {
    return cachedDbOk.ok
  }
  const ok = await Promise.race([
    db
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), RUNTIME_READYZ_DB_TIMEOUT_MS)
    ),
  ])
  cachedDbOk = { at: now, ok }
  return ok
}

export async function GET() {
  const drain = drainState()
  if (drain.draining) {
    return Response.json(
      {
        status: "unready" as const,
        reason: "draining",
        release: getReleaseId(),
        instance: getInstanceId(),
        drain,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }
  const dbOk = await probeDatabase()
  const status = dbOk ? ("healthy" as const) : ("degraded" as const)
  return Response.json(
    {
      status,
      release: getReleaseId(),
      instance: getInstanceId(),
      drain,
      checks: { database: dbOk ? "ok" : "failed" },
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  )
}
