import { reconcilePendingCosts } from "@/lib/billing/credits"
import { isVercelGatewayConfigured } from "@/lib/payments/vercel-gateway"

// 真实成本对账端点：拉取 Vercel 网关的 generation 真实成本，修正估算扣费。
// 供定时任务调用（如 Vercel Cron）。用 CRON_SECRET 做鉴权，未配置则拒绝（避免裸奔）。
export const maxDuration = 60

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization")
  return (
    auth === `Bearer ${secret}` || req.headers.get("x-cron-secret") === secret
  )
}

async function run(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "未授权" }, { status: 401 })
  }
  if (!isVercelGatewayConfigured()) {
    return Response.json(
      {
        error: "未配置 Vercel AI 网关（AI_GATEWAY_API_KEY），无真实成本可对账",
      },
      { status: 400 }
    )
  }
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 100
  const result = await reconcilePendingCosts(limit)
  return Response.json({ ok: true, ...result })
}

// GET 便于 Vercel Cron 触发；POST 便于手动/其他调度
export const GET = run
export const POST = run
