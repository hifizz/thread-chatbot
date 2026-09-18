import {
  evaluateDbAlertRules,
  processAlertEvaluations,
} from "@/lib/observability/alert-rules"
import { ALERT_RULES } from "@/constants/alerts"

// 告警评估端点：供定时任务（Vercel Cron 等）驱动 DB 事实规则的评估与通知。
// 鉴权沿用 CRON_SECRET；external/axiom 数据源规则由各自系统独立评估。
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
  const evaluations = await evaluateDbAlertRules()
  const outcome = await processAlertEvaluations(evaluations)
  return Response.json({
    ok: true,
    evaluated: evaluations.map((evaluation) => ({
      rule: evaluation.rule.key,
      firing: evaluation.firing,
      value: evaluation.value,
      samples: evaluation.samples,
    })),
    skippedRules: ALERT_RULES.filter(
      (rule) => rule.dataSource !== "db" || rule.pendingDependency
    ).map((rule) => ({
      rule: rule.key,
      reason: rule.pendingDependency ?? `dataSource=${rule.dataSource}`,
    })),
    ...outcome,
  })
}

// GET 便于 Vercel Cron 触发；POST 便于手动/其他调度
export const GET = run
export const POST = run
