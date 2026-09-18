// DB 事实告警的评估与去重：规则见 constants/alerts.ts。
// 数据源为 external/axiom 或 pendingDependency 的规则不在此评估——
// 它们的监视由对应系统按注册表阈值配置，应用宕机时仍负责送达。
// 评估结果写入 alert_rule_states 做跨实例去重与冷却；webhook 未配置时
// 状态照常更新，只是不送达（诊断日志记录 skipped）。

import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  ALERT_RULES,
  ALERT_WEBHOOK_TIMEOUT_MS,
  ALERT_WEBHOOK_URL_ENV,
  type AlertRule,
} from "@/constants/alerts"
import { GENERATION_LEASE_MS } from "@/constants/generation"
import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import { logDiagnostic } from "@/lib/observability/diagnostic-log"
import { resolveObservabilityConfig } from "@/lib/observability/config"

export type AlertEvaluation = {
  rule: AlertRule
  dedupKey: string
  firing: boolean
  /** 触发判定的观测值（计数/百分比），样本不足时为 null。 */
  value: number | null
  samples: number
  /** 补充上下文（如最老积压滞留毫秒），不得含用户内容。 */
  detail?: string
}

export type AlertNotificationKind = "firing" | "recovery"

type DbRuleProbe = (
  rule: AlertRule,
  now: Date
) => Promise<Omit<AlertEvaluation, "rule" | "dedupKey">>

async function probeStuckGenerations(
  rule: AlertRule
): Promise<Omit<AlertEvaluation, "rule" | "dedupKey">> {
  const rows = await db.execute<{ stuck: string | number }>(sql`
    select count(*) as stuck from thread_chat.messages m
    where m.role = 'assistant' and m.status = 'generating'
      and m.started_at < now() - (${GENERATION_LEASE_MS} || ' milliseconds')::interval
  `)
  const stuck = Number(rows[0]?.stuck ?? 0)
  return { firing: stuck >= rule.threshold, value: stuck, samples: stuck }
}

async function probeFailureRate(
  rule: AlertRule,
  now: Date
): Promise<Omit<AlertEvaluation, "rule" | "dedupKey">> {
  const windowStart = new Date(now.getTime() - rule.windowMinutes * 60_000)
  const rows = await db.execute<{
    completed: string | number
    failed: string | number
  }>(sql`
    select
      count(*) filter (where m.status = 'completed') as completed,
      count(*) filter (where m.status = 'failed') as failed
    from thread_chat.messages m
    where m.role = 'assistant' and m.status in ('completed', 'failed')
      and m.finished_at >= ${windowStart} and m.finished_at < ${now}
  `)
  const completed = Number(rows[0]?.completed ?? 0)
  const failed = Number(rows[0]?.failed ?? 0)
  const samples = completed + failed
  if (samples < rule.minSamples) {
    return {
      firing: false,
      value: null,
      samples,
      detail: `insufficient samples (${samples}/${rule.minSamples})`,
    }
  }
  const rate = (failed / samples) * 100
  return {
    firing: rate >= rule.threshold,
    value: Math.round(rate * 10) / 10,
    samples,
  }
}

async function probePendingBilling(
  rule: AlertRule
): Promise<Omit<AlertEvaluation, "rule" | "dedupKey">> {
  const rows = await db.execute<{
    pending: string | number
    oldest_ms: number | null
  }>(sql`
    select count(*) as pending,
      extract(epoch from (now() - min(ur.created_at))) * 1000 as oldest_ms
    from thread_chat.usage_records ur
    where ur.cost_source = 'estimate' and ur.generation_id is not null
  `)
  const pending = Number(rows[0]?.pending ?? 0)
  const oldestMs = rows[0]?.oldest_ms
  return {
    firing: pending >= rule.threshold,
    value: pending,
    samples: pending,
    detail:
      oldestMs !== null && oldestMs !== undefined
        ? `oldest ${Math.round(Number(oldestMs) / 60_000)}m`
        : undefined,
  }
}

async function probeFeedbackOutbox(
  rule: AlertRule
): Promise<Omit<AlertEvaluation, "rule" | "dedupKey">> {
  const rows = await db.execute<{
    pending: string | number
    oldest_ms: number | null
  }>(sql`
    select count(*) as pending,
      extract(epoch from (now() - min(o.created_at))) * 1000 as oldest_ms
    from thread_chat.feedback_score_outbox o
    where o.version > o.delivered_version
  `)
  const pending = Number(rows[0]?.pending ?? 0)
  const oldestMs = rows[0]?.oldest_ms
  return {
    firing: pending >= rule.threshold,
    value: pending,
    samples: pending,
    detail:
      oldestMs !== null && oldestMs !== undefined
        ? `oldest ${Math.round(Number(oldestMs) / 60_000)}m`
        : undefined,
  }
}

const DB_RULE_PROBES: Record<string, DbRuleProbe> = {
  "generation-stuck-lease": probeStuckGenerations,
  "generation-failure-rate": probeFailureRate,
  "billing-pending-reconcile": probePendingBilling,
  "feedback-outbox-backlog": probeFeedbackOutbox,
}

export async function evaluateDbAlertRules(now = new Date()): Promise<
  AlertEvaluation[]
> {
  const evaluations: AlertEvaluation[] = []
  for (const rule of ALERT_RULES) {
    if (rule.dataSource !== "db" || rule.pendingDependency) continue
    const probe = DB_RULE_PROBES[rule.key]
    if (!probe) continue
    try {
      const result = await probe(rule, now)
      evaluations.push({ rule, dedupKey: rule.key, ...result })
    } catch (error) {
      logDiagnostic(
        AI_DIAGNOSTIC_EVENTS.alertEvaluationFailed,
        { ruleKey: rule.key },
        error,
        "warn"
      )
    }
  }
  return evaluations
}

type AlertStateRow = {
  key: string
  state: string
  fired_at: string | Date
  last_notified_at: string | Date | null
  notified_count: string | number
}

async function deliverAlertNotification(
  kind: AlertNotificationKind,
  evaluation: AlertEvaluation
): Promise<"delivered" | "not-configured" | "failed"> {
  const url = process.env[ALERT_WEBHOOK_URL_ENV]
  if (!url) return "not-configured"
  const config = resolveObservabilityConfig()
  const { rule } = evaluation
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        rule: rule.key,
        state: kind === "firing" ? "firing" : "recovered",
        value: evaluation.value,
        samples: evaluation.samples,
        detail: evaluation.detail ?? null,
        owner: rule.owner,
        channel: rule.channel,
        runbook: rule.runbook,
        description: rule.description,
        environment: config.environment,
        release: config.release,
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(ALERT_WEBHOOK_TIMEOUT_MS),
    })
    if (!response.ok) return "failed"
    return "delivered"
  } catch (error) {
    logDiagnostic(
      AI_DIAGNOSTIC_EVENTS.alertDeliveryFailed,
      { ruleKey: rule.key, kind },
      error,
      "warn"
    )
    return "failed"
  }
}

/**
 * 评估并处理告警状态迁移：
 * - ok→firing：立即通知（冷却不适用首次触发）
 * - firing→firing：超过冷却才提醒一次（重复合并）
 * - firing→ok：恢复单独通知一次
 * 通知失败不改变状态事实，只记诊断日志。
 */
export async function processAlertEvaluations(
  evaluations: AlertEvaluation[],
  now = new Date()
): Promise<{ notified: number; recovered: number; skipped: number }> {
  let notified = 0
  let recovered = 0
  let skipped = 0

  for (const evaluation of evaluations) {
    const { rule } = evaluation
    const stateKey = `${rule.key}:${evaluation.dedupKey}`
    const existing = await db.execute<AlertStateRow>(sql`
      select key, state, fired_at, last_notified_at, notified_count
      from thread_chat.alert_rule_states where key = ${stateKey} limit 1
    `)
    const row = existing[0]
    const lastNotifiedAt = row?.last_notified_at
      ? new Date(row.last_notified_at).getTime()
      : null
    const cooldownMs = rule.cooldownMinutes * 60_000

    if (evaluation.firing) {
      const isNew = !row || row.state !== "firing"
      const cooledDown =
        lastNotifiedAt === null || now.getTime() - lastNotifiedAt >= cooldownMs
      if (!isNew && !cooledDown) {
        await db.execute(sql`
          update thread_chat.alert_rule_states
          set last_evaluated_at = ${now}, last_value = ${String(evaluation.value)}
          where key = ${stateKey}
        `)
        skipped++
        continue
      }
      await db.execute(sql`
        insert into thread_chat.alert_rule_states
          (key, state, fired_at, last_notified_at, notified_count, last_evaluated_at, last_value)
        values (${stateKey}, 'firing', ${isNew ? now : (row ? new Date(row.fired_at) : now)},
          ${now}, ${Number(row?.notified_count ?? 0) + 1}, ${now}, ${String(evaluation.value)})
        on conflict (key) do update set
          state = 'firing',
          last_notified_at = ${now},
          notified_count = thread_chat.alert_rule_states.notified_count + 1,
          last_evaluated_at = ${now},
          last_value = ${String(evaluation.value)}
      `)
      const result = await deliverAlertNotification("firing", evaluation)
      if (result === "not-configured")
        logDiagnostic(
          AI_DIAGNOSTIC_EVENTS.alertDeliverySkipped,
          { ruleKey: rule.key },
          undefined,
          "info"
        )
      notified++
      continue
    }

    if (row?.state === "firing") {
      await db.execute(sql`
        update thread_chat.alert_rule_states
        set state = 'ok', last_evaluated_at = ${now}, last_value = ${String(evaluation.value)}
        where key = ${stateKey}
      `)
      await deliverAlertNotification("recovery", evaluation)
      recovered++
    }
  }
  return { notified, recovered, skipped }
}
