import { sql } from "drizzle-orm"
import {
  ADMIN_METRICS_MAX_DAYS,
  INTERNAL_TEST_USER_EMAILS_ENV,
  METRIC_TIMEZONE,
} from "@/constants/analytics"
import { GENERATION_LEASE_MS } from "@/constants/generation"
import { db } from "@/lib/db"

/**
 * 运营指标聚合：只读自有 DB 的服务事实（必要用途），与 PostHog 同意人群分开标注。
 * 所有桶固定 UTC；内部测试账号（INTERNAL_TEST_USER_EMAILS）从分母与样本中排除。
 * PostHog/Langfuse 是否可用与本模块无关，指标不依赖第三方投递。
 */

import {
  isUtcDay,
  shiftUtcDay,
  utcToday,
  type UtcDay,
} from "@/lib/analytics/utc-day"

export type { UtcDay }

export type DailyServiceMetrics = {
  date: UtcDay
  serviceActiveUsers: number
  analyticsConsentedUsers: number
  acceptedGenerations: number
  completedGenerations: number
  failedGenerations: number
  stoppedGenerations: number
  supersededGenerations: number
  providerCostMicros: number
  customerChargeMicros: number
  reconciledCostAttempts: number
  unknownCostAttempts: number
  costCoverage: "complete" | "estimated" | "partial" | "none"
}

export type LatencySummary = {
  scope: string
  samples: number
  ttftSamples: number
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  totalP50Ms: number | null
  totalP95Ms: number | null
}

export type GenerationSnapshot = {
  runningGenerations: number
  stuckBeyondLease: number
  leaseMs: number
  pendingFeedbackOutbox: number
}

export type CohortRow = {
  cohortDay: UtcDay
  registeredUsers: number
  firstAnswerWithin7d: number | null
  activationWithin7d: number | null
  retainedD1: number | null
  retainedD7: number | null
  window7dComplete: boolean
  windowD1Complete: boolean
  windowD7Complete: boolean
}

export type ServiceMetricsResponse = {
  timezone: typeof METRIC_TIMEZONE
  asOf: string
  range: { from: UtcDay; to: UtcDay }
  excludedPopulations: string[]
  consentNote: string
  days: DailyServiceMetrics[]
  latency: LatencySummary[]
  snapshot: GenerationSnapshot
}

export type UserActivitySummary = {
  userId: string
  name: string
  email: string
  emailVerified: boolean
  locale: string | null
  registeredAt: string
  internalTestUser: boolean
  analyticsConsent: "active" | "none"
  lastServiceActionAt: string | null
  balanceMicros: number | null
  providerCostMicros: number
  customerChargeMicros: number
  unknownCostAttempts: number
  acceptedGenerations: number
  completedGenerations: number
  failedGenerations: number
  stoppedGenerations: number
  runningGenerations: number
  branchThreads: number
  artifactCount: number
  feedbackUp: number
  feedbackDown: number
  openDataRequests: number
}

type EnvironmentSource = Record<string, string | undefined>

export function internalTestEmails(
  source: EnvironmentSource = process.env
): string[] {
  return (source[INTERNAL_TEST_USER_EMAILS_ENV] ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

const DAY_MS = 24 * 60 * 60 * 1000

export { isUtcDay, shiftUtcDay, utcToday }

export function resolveMetricsRange(input: {
  from?: string | null
  to?: string | null
  now?: Date
}): { from: UtcDay; to: UtcDay } | null {
  const today = utcToday(input.now)
  const to = input.to && isUtcDay(input.to) ? input.to : today
  const from = input.from && isUtcDay(input.from) ? input.from : shiftUtcDay(to, -13)
  if (from > to) return null
  const spanDays =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
    ) + 1
  if (spanDays < 1 || spanDays > ADMIN_METRICS_MAX_DAYS) return null
  return { from, to }
}

/** 内部测试账号排除条件：邮箱在 INTERNAL_TEST_USER_EMAILS 中即排除。 */
function exclusionSql(emails: string[], column = sql`u.id`) {
  if (emails.length === 0) return sql`true`
  return sql`not exists (
    select 1 from thread_chat."user" u
    where u.id = ${column} and lower(u.email) = any(${emails})
  )`
}

/**
 * 服务活动事实（DAU 口径）：受理生成、成功创建分支、Artifact 编辑三种事实。
 * 与产品事件同名口径，但来源是 DB 事实表而非投递记录。
 */
const ACTIVITY_CTE = sql`
  activity as (
    select p.user_id as user_id, (m.created_at at time zone 'UTC')::date as day
    from thread_chat.messages m
    join thread_chat.projects p on p.id = m.project_id
    where m.role = 'assistant'
    union all
    select p.user_id, (t.created_at at time zone 'UTC')::date
    from thread_chat.threads t
    join thread_chat.projects p on p.id = t.project_id
    where t.parent_id is not null
    union all
    select dr.actor_user_id, (dr.created_at at time zone 'UTC')::date
    from thread_chat.document_revisions dr
  )
`

const CONSENTED_CTE = sql`
  consented as (
    select distinct pc.user_id
    from thread_chat.privacy_consents pc
    where pc.decision = 'accepted'
      and pc.analytics = true
      and pc.expires_at > now()
  )
`

async function dailyActivityBuckets(
  from: UtcDay,
  toExclusive: UtcDay,
  emails: string[]
): Promise<Map<UtcDay, { dau: number; consentedDau: number }>> {
  const rows = await db.execute<{
    day: string
    dau: string | number
    consented_dau: string | number
  }>(sql`
    with ${ACTIVITY_CTE}, ${CONSENTED_CTE}
    select a.day::text as day,
      count(distinct a.user_id) as dau,
      count(distinct a.user_id) filter (where c.user_id is not null) as consented_dau
    from activity a
    left join consented c on c.user_id = a.user_id
    where a.day >= ${from}::date and a.day < ${toExclusive}::date
      and ${exclusionSql(emails, sql`a.user_id`)}
    group by a.day
    order by a.day
  `)
  return new Map(
    rows.map((row) => [
      row.day,
      { dau: Number(row.dau), consentedDau: Number(row.consented_dau) },
    ])
  )
}

async function dailyGenerationBuckets(
  from: UtcDay,
  toExclusive: UtcDay,
  emails: string[]
): Promise<
  Map<
    UtcDay,
    {
      accepted: number
      completed: number
      failed: number
      stopped: number
      superseded: number
    }
  >
> {
  // 每个状态按「进入该状态」的时间归入对应 UTC 日：accepted=createdAt，
  // completed/failed/stopped=finishedAt，superseded=supersededAt。
  const rows = await db.execute<{
    day: string
    status: string
    count: string | number
  }>(sql`
    with transitions as (
      select p.user_id, (m.created_at at time zone 'UTC')::date as day, 'accepted' as status
      from thread_chat.messages m
      join thread_chat.projects p on p.id = m.project_id
      where m.role = 'assistant'
      union all
      select p.user_id, (m.finished_at at time zone 'UTC')::date, m.status
      from thread_chat.messages m
      join thread_chat.projects p on p.id = m.project_id
      where m.role = 'assistant' and m.status in ('completed', 'failed', 'stopped')
      union all
      select p.user_id, (m.superseded_at at time zone 'UTC')::date, 'superseded'
      from thread_chat.messages m
      join thread_chat.projects p on p.id = m.project_id
      where m.role = 'assistant' and m.superseded_at is not null
    )
    select day::text as day, status, count(*) as count
    from transitions t
    where t.day >= ${from}::date and t.day < ${toExclusive}::date
      and ${exclusionSql(emails, sql`t.user_id`)}
    group by day, status
  `)
  const map = new Map<
    UtcDay,
    {
      accepted: number
      completed: number
      failed: number
      stopped: number
      superseded: number
    }
  >()
  for (const row of rows) {
    const bucket = map.get(row.day) ?? {
      accepted: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      superseded: 0,
    }
    const key = row.status as keyof typeof bucket
    if (key in bucket) bucket[key] = Number(row.count)
    map.set(row.day, bucket)
  }
  return map
}

async function dailyCostBuckets(
  from: UtcDay,
  toExclusive: UtcDay,
  emails: string[]
): Promise<
  Map<
    UtcDay,
    {
      providerCostMicros: number
      customerChargeMicros: number
      reconciled: number
      estimated: number
    }
  >
> {
  const rows = await db.execute<{
    day: string
    provider_cost: string | number | null
    customer_charge: string | number | null
    reconciled: string | number
    estimated: string | number
  }>(sql`
    select (ur.created_at at time zone 'UTC')::date::text as day,
      coalesce(sum(ur.cost_micros), 0) as provider_cost,
      coalesce(sum(ur.price_micros), 0) as customer_charge,
      count(*) filter (where ur.cost_source <> 'estimate') as reconciled,
      count(*) filter (where ur.cost_source = 'estimate') as estimated
    from thread_chat.usage_records ur
    where (ur.created_at at time zone 'UTC')::date >= ${from}::date
      and (ur.created_at at time zone 'UTC')::date < ${toExclusive}::date
      and ${exclusionSql(emails, sql`ur.user_id`)}
    group by 1
  `)
  return new Map(
    rows.map((row) => [
      row.day,
      {
        providerCostMicros: Number(row.provider_cost ?? 0),
        customerChargeMicros: Number(row.customer_charge ?? 0),
        reconciled: Number(row.reconciled),
        estimated: Number(row.estimated),
      },
    ])
  )
}

async function latencyBuckets(
  from: UtcDay,
  toExclusive: UtcDay,
  emails: string[]
): Promise<LatencySummary[]> {
  // completed 生成按模型切分；TTFT 样本只含已记录 firstTokenAt 的生成。
  const rows = await db.execute<{
    scope: string
    samples: string | number
    ttft_samples: string | number
    ttft_p50: number | null
    ttft_p95: number | null
    total_p50: number | null
    total_p95: number | null
  }>(sql`
    with completed as (
      select m.model_id,
        extract(epoch from (m.first_token_at - m.started_at)) * 1000 as ttft_ms,
        extract(epoch from (m.finished_at - m.started_at)) * 1000 as total_ms
      from thread_chat.messages m
      join thread_chat.projects p on p.id = m.project_id
      where m.role = 'assistant'
        and m.status = 'completed'
        and m.started_at is not null
        and m.finished_at is not null
        and (m.finished_at at time zone 'UTC')::date >= ${from}::date
        and (m.finished_at at time zone 'UTC')::date < ${toExclusive}::date
        and ${exclusionSql(emails, sql`p.user_id`)}
    ), by_model as (
      select model_id as scope,
        count(*) as samples,
        count(ttft_ms) as ttft_samples,
        percentile_cont(0.5) within group (order by ttft_ms) as ttft_p50,
        percentile_cont(0.95) within group (order by ttft_ms) as ttft_p95,
        percentile_cont(0.5) within group (order by total_ms) as total_p50,
        percentile_cont(0.95) within group (order by total_ms) as total_p95
      from completed
      group by model_id
      union all
      select '_all', count(*), count(ttft_ms),
        percentile_cont(0.5) within group (order by ttft_ms),
        percentile_cont(0.95) within group (order by ttft_ms),
        percentile_cont(0.5) within group (order by total_ms),
        percentile_cont(0.95) within group (order by total_ms)
      from completed
    )
    select * from by_model order by scope
  `)
  return rows.map((row) => ({
    scope: row.scope === "_all" ? "all" : (row.scope ?? "unknown"),
    samples: Number(row.samples),
    ttftSamples: Number(row.ttft_samples),
    ttftP50Ms: row.ttft_p50 === null ? null : Math.round(Number(row.ttft_p50)),
    ttftP95Ms: row.ttft_p95 === null ? null : Math.round(Number(row.ttft_p95)),
    totalP50Ms:
      row.total_p50 === null ? null : Math.round(Number(row.total_p50)),
    totalP95Ms:
      row.total_p95 === null ? null : Math.round(Number(row.total_p95)),
  }))
}

async function generationSnapshot(
  emails: string[]
): Promise<GenerationSnapshot> {
  const rows = await db.execute<{
    running: string | number
    stuck: string | number
    outbox_backlog: string | number
  }>(sql`
    select
      (select count(*) from thread_chat.messages m
        join thread_chat.projects p on p.id = m.project_id
        where m.role = 'assistant' and m.status = 'generating'
          and ${exclusionSql(emails, sql`p.user_id`)}) as running,
      (select count(*) from thread_chat.messages m
        join thread_chat.projects p on p.id = m.project_id
        where m.role = 'assistant' and m.status = 'generating'
          and m.started_at < now() - (${GENERATION_LEASE_MS} || ' milliseconds')::interval
          and ${exclusionSql(emails, sql`p.user_id`)}) as stuck,
      (select count(*) from thread_chat.feedback_score_outbox o
        where o.version > o.delivered_version) as outbox_backlog
  `)
  const row = rows[0]
  return {
    runningGenerations: Number(row?.running ?? 0),
    stuckBeyondLease: Number(row?.stuck ?? 0),
    leaseMs: GENERATION_LEASE_MS,
    pendingFeedbackOutbox: Number(row?.outbox_backlog ?? 0),
  }
}

/**
 * 成本覆盖语义：complete=全部调用已对账真实成本；estimated=全部只有价目表估算；
 * partial=两者混合；none=当日无调用。不假装估算等于真实成本。
 */
export function resolveCostCoverage(
  reconciled: number,
  estimated: number
): "complete" | "estimated" | "partial" | "none" {
  const attempts = reconciled + estimated
  if (attempts === 0) return "none"
  if (estimated === 0) return "complete"
  return reconciled === 0 ? "estimated" : "partial"
}

export async function getServiceMetrics(input: {
  from: UtcDay
  to: UtcDay
  env?: EnvironmentSource
}): Promise<ServiceMetricsResponse> {
  const emails = internalTestEmails(input.env)
  const toExclusive = shiftUtcDay(input.to, 1)
  const [activity, generations, costs, latency, snapshot] = await Promise.all([
    dailyActivityBuckets(input.from, toExclusive, emails),
    dailyGenerationBuckets(input.from, toExclusive, emails),
    dailyCostBuckets(input.from, toExclusive, emails),
    latencyBuckets(input.from, toExclusive, emails),
    generationSnapshot(emails),
  ])
  const days: DailyServiceMetrics[] = []
  for (
    let day = input.from;
    day <= input.to;
    day = shiftUtcDay(day, 1)
  ) {
    const a = activity.get(day) ?? { dau: 0, consentedDau: 0 }
    const g = generations.get(day) ?? {
      accepted: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      superseded: 0,
    }
    const c = costs.get(day) ?? {
      providerCostMicros: 0,
      customerChargeMicros: 0,
      reconciled: 0,
      estimated: 0,
    }
    days.push({
      date: day,
      serviceActiveUsers: a.dau,
      analyticsConsentedUsers: a.consentedDau,
      acceptedGenerations: g.accepted,
      completedGenerations: g.completed,
      failedGenerations: g.failed,
      stoppedGenerations: g.stopped,
      supersededGenerations: g.superseded,
      providerCostMicros: c.providerCostMicros,
      customerChargeMicros: c.customerChargeMicros,
      reconciledCostAttempts: c.reconciled,
      unknownCostAttempts: c.estimated,
      costCoverage: resolveCostCoverage(c.reconciled, c.estimated),
    })
  }
  return {
    timezone: METRIC_TIMEZONE,
    asOf: new Date().toISOString(),
    range: { from: input.from, to: input.to },
    excludedPopulations: [
      "internal-test-users",
      "service-facts-only-no-posthog-identity",
    ],
    consentNote:
      "analyticsConsentedUsers 为当日活跃用户中当前持有有效分析授权的用户；" +
      "PostHog 留存只代表该同意人群，不代表全体用户。",
    days,
    latency,
    snapshot,
  }
}

/** 观察窗口完整性：目标日已过才算成熟；当天或未来一律视为窗口未满。 */
export function cohortWindowComplete(
  cohortDay: UtcDay,
  offsetDays: number,
  today: UtcDay
): boolean {
  return shiftUtcDay(cohortDay, offsetDays) < today
}

/**
 * 注册 cohort 视图：近 cohortDays 个 UTC 注册日的首次回答率、激活率与 D1/D7。
 * 窗口未成熟的 cohort 对应字段返回 null，不显示为流失。
 */
export async function getCohortRetention(input: {
  cohortDays?: number
  env?: EnvironmentSource
  now?: Date
}): Promise<{
  timezone: typeof METRIC_TIMEZONE
  asOf: string
  cohorts: CohortRow[]
}> {
  const emails = internalTestEmails(input.env)
  const cohortDays = Math.min(
    Math.max(1, Math.floor(input.cohortDays ?? 30)),
    ADMIN_METRICS_MAX_DAYS
  )
  const today = utcToday(input.now)
  const from = shiftUtcDay(today, -(cohortDays - 1))
  const rows = await db.execute<{
    cohort_day: string
    registered: string | number
    first_answer_7d: string | number
    activation_7d: string | number
    retained_d1: string | number
    retained_d7: string | number
  }>(sql`
    with ${ACTIVITY_CTE}, cohort as (
      select u.id as user_id, (u.created_at at time zone 'UTC')::date as cohort_day
      from thread_chat."user" u
      where (u.created_at at time zone 'UTC')::date >= ${from}::date
        and (u.created_at at time zone 'UTC')::date <= ${today}::date
        and ${exclusionSql(emails)}
    ), first_answer as (
      select c.user_id, min((m.finished_at at time zone 'UTC')::date) as answer_day
      from cohort c
      join thread_chat.projects p on p.user_id = c.user_id
      join thread_chat.messages m on m.project_id = p.id
      where m.role = 'assistant' and m.status = 'completed' and m.finished_at is not null
      group by c.user_id
    ), activation as (
      select c.user_id, min((m.finished_at at time zone 'UTC')::date) as activation_day
      from cohort c
      join thread_chat.projects p on p.user_id = c.user_id
      join thread_chat.messages m on m.project_id = p.id
      join thread_chat.threads t on t.id = m.thread_id and t.parent_id is not null
      where m.role = 'assistant' and m.status = 'completed' and m.finished_at is not null
      group by c.user_id
    ), activity_days as (
      select a.user_id, a.day from activity a join cohort c on c.user_id = a.user_id
    )
    select c.cohort_day::text as cohort_day,
      count(*) as registered,
      count(*) filter (where fa.answer_day is not null
        and fa.answer_day <= c.cohort_day + 7) as first_answer_7d,
      count(*) filter (where ac.activation_day is not null
        and ac.activation_day <= c.cohort_day + 7) as activation_7d,
      count(*) filter (where ad1.day = c.cohort_day + 1) as retained_d1,
      count(*) filter (where ad7.day = c.cohort_day + 7) as retained_d7
    from cohort c
    left join first_answer fa on fa.user_id = c.user_id
    left join activation ac on ac.user_id = c.user_id
    left join activity_days ad1 on ad1.user_id = c.user_id and ad1.day = c.cohort_day + 1
    left join activity_days ad7 on ad7.user_id = c.user_id and ad7.day = c.cohort_day + 7
    group by c.cohort_day
    order by c.cohort_day desc
  `)
  const cohorts: CohortRow[] = rows.map((row) => {
    const cohortDay = row.cohort_day
    const registered = Number(row.registered)
    const windowD1Complete = cohortWindowComplete(cohortDay, 1, today)
    const windowD7Complete = cohortWindowComplete(cohortDay, 7, today)
    return {
      cohortDay,
      registeredUsers: registered,
      firstAnswerWithin7d: windowD7Complete
        ? Number(row.first_answer_7d)
        : null,
      activationWithin7d: windowD7Complete
        ? Number(row.activation_7d)
        : null,
      retainedD1: windowD1Complete ? Number(row.retained_d1) : null,
      retainedD7: windowD7Complete ? Number(row.retained_d7) : null,
      window7dComplete: windowD7Complete,
      windowD1Complete,
      windowD7Complete,
    }
  })
  return {
    timezone: METRIC_TIMEZONE,
    asOf: new Date().toISOString(),
    cohorts,
  }
}

export async function getUserActivitySummary(input: {
  userId: string
  env?: EnvironmentSource
}): Promise<UserActivitySummary | null> {
  const emails = internalTestEmails(input.env)
  const rows = await db.execute<{
    id: string
    name: string
    email: string
    email_verified: boolean
    locale: string | null
    registered_at: string | Date
    balance_micros: string | number | null
    analytics_consent: string | number
    last_action_at: string | Date | null
    provider_cost: string | number | null
    customer_charge: string | number | null
    unknown_attempts: string | number
    accepted: string | number
    completed: string | number
    failed: string | number
    stopped: string | number
    running: string | number
    branches: string | number
    artifact_count: string | number
    feedback_up: string | number
    feedback_down: string | number
    open_requests: string | number
  }>(sql`
    with ${ACTIVITY_CTE}, gen as (
      select p.user_id,
        count(*) filter (where m.status = 'completed') as completed,
        count(*) filter (where m.status = 'failed') as failed,
        count(*) filter (where m.status = 'stopped') as stopped,
        count(*) filter (where m.status = 'generating') as running,
        count(*) as accepted,
        count(*) filter (where m.feedback = 'up') as feedback_up,
        count(*) filter (where m.feedback = 'down') as feedback_down
      from thread_chat.messages m
      join thread_chat.projects p on p.id = m.project_id
      where m.role = 'assistant'
      group by p.user_id
    ), usage as (
      select ur.user_id,
        coalesce(sum(ur.cost_micros), 0) as provider_cost,
        coalesce(sum(ur.price_micros), 0) as customer_charge,
        count(*) filter (where ur.cost_source = 'estimate') as unknown_attempts
      from thread_chat.usage_records ur
      group by ur.user_id
    ), branches as (
      select p.user_id, count(*) as count
      from thread_chat.threads t
      join thread_chat.projects p on p.id = t.project_id
      where t.parent_id is not null
      group by p.user_id
    ), arts as (
      select p.user_id, count(*) as count
      from thread_chat.artifacts a
      join thread_chat.projects p on p.id = a.project_id
      group by p.user_id
    ), last_action as (
      select user_id, max(day) as last_day from activity group by user_id
    )
    select u.id, u.name, u.email, u.email_verified, u.locale,
      u.created_at as registered_at,
      uc.balance_micros,
      coalesce((select count(*) from thread_chat.privacy_consents pc
        where pc.user_id = u.id and pc.decision = 'accepted'
          and pc.analytics = true and pc.expires_at > now()), 0) as analytics_consent,
      la.last_day as last_action_at,
      coalesce(usage.provider_cost, 0) as provider_cost,
      coalesce(usage.customer_charge, 0) as customer_charge,
      coalesce(usage.unknown_attempts, 0) as unknown_attempts,
      coalesce(gen.accepted, 0) as accepted,
      coalesce(gen.completed, 0) as completed,
      coalesce(gen.failed, 0) as failed,
      coalesce(gen.stopped, 0) as stopped,
      coalesce(gen.running, 0) as running,
      coalesce(branches.count, 0) as branches,
      coalesce(arts.count, 0) as artifact_count,
      coalesce(gen.feedback_up, 0) as feedback_up,
      coalesce(gen.feedback_down, 0) as feedback_down,
      coalesce((select count(*) from thread_chat.privacy_data_requests dr
        where dr.user_id = u.id
          and dr.status in ('requested', 'verified', 'processing')), 0) as open_requests
    from thread_chat."user" u
    left join thread_chat.user_credits uc on uc.user_id = u.id
    left join usage on usage.user_id = u.id
    left join gen on gen.user_id = u.id
    left join branches on branches.user_id = u.id
    left join arts on arts.user_id = u.id
    left join last_action la on la.user_id = u.id
    where u.id = ${input.userId}
    limit 1
  `)
  const row = rows[0]
  if (!row) return null
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    locale: row.locale,
    registeredAt: new Date(row.registered_at).toISOString(),
    internalTestUser: emails.includes(row.email.toLowerCase()),
    analyticsConsent: Number(row.analytics_consent) > 0 ? "active" : "none",
    lastServiceActionAt: row.last_action_at
      ? new Date(row.last_action_at).toISOString()
      : null,
    balanceMicros:
      row.balance_micros === null ? null : Number(row.balance_micros),
    providerCostMicros: Number(row.provider_cost ?? 0),
    customerChargeMicros: Number(row.customer_charge ?? 0),
    unknownCostAttempts: Number(row.unknown_attempts),
    acceptedGenerations: Number(row.accepted),
    completedGenerations: Number(row.completed),
    failedGenerations: Number(row.failed),
    stoppedGenerations: Number(row.stopped),
    runningGenerations: Number(row.running),
    branchThreads: Number(row.branches),
    artifactCount: Number(row.artifact_count),
    feedbackUp: Number(row.feedback_up),
    feedbackDown: Number(row.feedback_down),
    openDataRequests: Number(row.open_requests),
  }
}

export type AdminUserListItem = {
  userId: string
  name: string
  email: string
  registeredAt: string
  lastServiceActionAt: string | null
  completedGenerations: number
  internalTestUser: boolean
}

/** 运营列表：按最近活动或注册时间排序；限制分页大小，不含聊天内容。 */
export async function listAdminUsers(input: {
  limit: number
  offset: number
  env?: EnvironmentSource
}): Promise<{ users: AdminUserListItem[]; total: number }> {
  const emails = internalTestEmails(input.env)
  const limit = Math.min(Math.max(1, Math.floor(input.limit)), 50)
  const offset = Math.max(0, Math.floor(input.offset))
  const rows = await db.execute<{
    id: string
    name: string
    email: string
    registered_at: string | Date
    last_day: string | null
    completed: string | number
    total: string | number
  }>(sql`
    with ${ACTIVITY_CTE}, last_action as (
      select user_id, max(day) as last_day from activity group by user_id
    ), gen as (
      select p.user_id,
        count(*) filter (where m.status = 'completed') as completed
      from thread_chat.messages m
      join thread_chat.projects p on p.id = m.project_id
      where m.role = 'assistant'
      group by p.user_id
    )
    select u.id, u.name, u.email, u.created_at as registered_at,
      la.last_day, coalesce(gen.completed, 0) as completed,
      count(*) over () as total
    from thread_chat."user" u
    left join last_action la on la.user_id = u.id
    left join gen on gen.user_id = u.id
    order by coalesce(la.last_day, (u.created_at at time zone 'UTC')::date) desc nulls last,
      u.created_at desc
    limit ${limit} offset ${offset}
  `)
  return {
    users: rows.map((row) => ({
      userId: row.id,
      name: row.name,
      email: row.email,
      registeredAt: new Date(row.registered_at).toISOString(),
      lastServiceActionAt: row.last_day
        ? new Date(row.last_day).toISOString()
        : null,
      completedGenerations: Number(row.completed),
      internalTestUser: emails.includes(row.email.toLowerCase()),
    })),
    total: Number(rows[0]?.total ?? 0),
  }
}
