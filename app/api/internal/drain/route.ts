import { z } from "zod"
import {
  abortRemainingGenerations,
  beginDrain,
  drainState,
  waitForQuiesce,
} from "@/lib/runtime/drain"
import { getInstanceId, getReleaseId } from "@/lib/runtime/instance"

/**
 * 机器身份才能调用的部署收尾端点（复用 CRON_SECRET Bearer，与 billing/reconcile 一致）。
 *
 * - POST /api/internal/drain：本实例进入 drain——readyz 立即 503 摘除流量；
 *   默认 graceful（在途任务跑完），body {abort:true} 强制中止，{waitMs} 同步等待排空。
 * - GET /api/internal/drain：只读当前 DrainState，供部署脚本轮询。
 *
 * 该端点是「按 Machine 定向」使用的：调用方需带 fly-force-instance-id 头
 * 或逐台内网地址访问，普通匿名 GET 不得有副作用。
 */

export const dynamic = "force-dynamic"

const drainBodySchema = z
  .object({
    waitMs: z.number().int().min(0).max(300_000).optional(),
    abort: z.boolean().optional(),
  })
  .strict()

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get("authorization")
  return (
    auth === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  )
}

function unauthorized(): Response {
  return Response.json({ error: "未授权" }, { status: 401 })
}

function body(): Record<string, unknown> {
  return {
    instance: getInstanceId(),
    release: getReleaseId(),
    drain: drainState(),
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized()
  return Response.json(body(), { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized()
  let options: z.infer<typeof drainBodySchema>
  try {
    options = drainBodySchema.parse(await request.json().catch(() => ({})))
  } catch {
    return Response.json({ error: "请求体不合法" }, { status: 400 })
  }
  // 默认 graceful：只关准入让在途任务完成；abort:true 时才中止在途生成。
  beginDrain({ abortInFlight: options.abort === true })
  if (options.abort === true) abortRemainingGenerations()
  const quiesced =
    options.waitMs && options.waitMs > 0
      ? await waitForQuiesce(options.waitMs)
      : null
  return Response.json(
    { ...body(), ...(quiesced === null ? {} : { quiesced }) },
    { headers: { "Cache-Control": "no-store" } }
  )
}
