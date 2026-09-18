// 运营告警规则注册表：每条规则固定窗口、最小样本、阈值、冷却、负责人、渠道与
// runbook。数据源分三类：db=本仓库 DB 事实（应用内评估器处理）、axiom=Axiom
// 日志监视（阈值以此处为准）、external=应用外系统（应用宕机时仍能送达）。
// 未配置接收渠道或未演练送达的规则不得在发布清单上标完成。

export const ALERT_CHANNELS = {
  /** 运维 Webhook（飞书/Slack 兼容 JSON），环境变量 ALERT_WEBHOOK_URL。 */
  opsWebhook: "ops-webhook",
  /** 外部可用性探测/供应商面板等应用外系统，应用宕机时仍负责送达。 */
  external: "external",
  /** Axiom monitor，对结构化诊断事件计数。 */
  axiomMonitor: "axiom-monitor",
} as const

export type AlertChannel = (typeof ALERT_CHANNELS)[keyof typeof ALERT_CHANNELS]

export type AlertRuleDataSource = "db" | "external" | "axiom"

export type AlertRule = {
  key: string
  /** 评估窗口（分钟）。即时状态型规则（如超 lease）窗口记 0。 */
  windowMinutes: number
  /** 最小样本数；不足时只报告样本不足，不触发。 */
  minSamples: number
  /** 触发阈值，单位见 description（次数/百分比/毫秒）。 */
  threshold: number
  /** 同一去重键两次通知之间的最小间隔（分钟）。 */
  cooldownMinutes: number
  owner: string
  channel: AlertChannel
  dataSource: AlertRuleDataSource
  runbook: string
  description: string
  /** 依赖其他 PR 的数据源（如邮件 outbox）时注明，未就绪不得标完成。 */
  pendingDependency?: string
}

export const ALERT_RULES: readonly AlertRule[] = [
  {
    key: "external-availability",
    windowMinutes: 5,
    minSamples: 2,
    threshold: 2,
    cooldownMinutes: 30,
    owner: "on-call",
    channel: ALERT_CHANNELS.external,
    dataSource: "external",
    runbook:
      "外部探测连续失败：确认部署与数据库可用性，检查状态页；应用自身不可达时通知也必须送达。",
    description:
      "外部可用性探测对 /api/health 连续不可达次数；由应用外监控送达，不依赖应用运行。",
  },
  {
    key: "provider-auth-rate-limit",
    windowMinutes: 15,
    minSamples: 3,
    threshold: 3,
    cooldownMinutes: 60,
    owner: "on-call",
    channel: ALERT_CHANNELS.axiomMonitor,
    dataSource: "axiom",
    runbook:
      "同一 provider 连续 authentication/rate_limit：核对密钥与额度，必要时切换备用供应商。",
    description:
      "provider.failure 诊断事件中 errorCategory=authentication|rate_limit 的按供应商连续计数。",
  },
  {
    key: "generation-failure-rate",
    windowMinutes: 60,
    minSamples: 20,
    threshold: 30,
    cooldownMinutes: 60,
    owner: "on-call",
    channel: ALERT_CHANNELS.opsWebhook,
    dataSource: "db",
    runbook:
      "失败率异常：按 errorCode 分组排查最近失败 Generation 与对应 trace，确认供应商与发布回滚。",
    description:
      "窗口内 failed/(completed+failed) 百分比；stopped/superseded 不计入分母。",
  },
  {
    key: "generation-stuck-lease",
    windowMinutes: 0,
    minSamples: 1,
    threshold: 1,
    cooldownMinutes: 30,
    owner: "on-call",
    channel: ALERT_CHANNELS.opsWebhook,
    dataSource: "db",
    runbook:
      "存在超过租约仍在 generating 的 Generation：检查实例健康与清扫任务，必要时人工标记失败。",
    description: "status=generating 且 startedAt 超过 GENERATION_LEASE_MS 的数量。",
  },
  {
    key: "billing-pending-reconcile",
    windowMinutes: 0,
    minSamples: 1,
    threshold: 50,
    cooldownMinutes: 240,
    owner: "ops",
    channel: ALERT_CHANNELS.opsWebhook,
    dataSource: "db",
    runbook:
      "待对账 usage_records 积压：确认 /api/billing/reconcile 定时任务与 Vercel 网关密钥。",
    description:
      "cost_source=estimate 且有 generationId 的待对账记录数；附最老一条的滞留时长。",
  },
  {
    key: "feedback-outbox-backlog",
    windowMinutes: 0,
    minSamples: 1,
    threshold: 10,
    cooldownMinutes: 120,
    owner: "ops",
    channel: ALERT_CHANNELS.opsWebhook,
    dataSource: "db",
    runbook:
      "反馈 outbox 积压：确认 Langfuse 密钥与 drain 定时任务；积压只影响分析评分不影响业务。",
    description:
      "feedback_score_outbox 中 version>delivered_version 的未投递记录数。",
  },
  {
    key: "email-outbox-backlog",
    windowMinutes: 0,
    minSamples: 1,
    threshold: 10,
    cooldownMinutes: 120,
    owner: "ops",
    channel: ALERT_CHANNELS.opsWebhook,
    dataSource: "db",
    runbook: "邮件 outbox 积压：确认 Resend 密钥与投递 worker。",
    description: "邀请/通知邮件待发送记录数。",
    pendingDependency: "依赖 #166 邮件 outbox 表，合并后启用评估",
  },
  {
    key: "provider-quota-low",
    windowMinutes: 60,
    minSamples: 1,
    threshold: 1,
    cooldownMinutes: 360,
    owner: "ops",
    channel: ALERT_CHANNELS.external,
    dataSource: "external",
    runbook:
      "供应商账户低额度：核对余额最后同步时间（非实时），充值或切换备用供应商。",
    description:
      "供应商账户余额/预算低于阈值；通知必须标注余额最后同步时间，不能虚称实时。",
  },
  {
    key: "db-resource-pressure",
    windowMinutes: 15,
    minSamples: 3,
    threshold: 3,
    cooldownMinutes: 60,
    owner: "on-call",
    channel: ALERT_CHANNELS.axiomMonitor,
    dataSource: "axiom",
    runbook:
      "数据库连接耗尽或内存压力：查看实例指标与连接池配置，必要时扩容或重启。",
    description: "数据库连接/内存压力事件计数（平台指标或诊断日志）。",
  },
] as const

/** 告警 Webhook 投递配置；未配置时评估仍运行，仅不送达。 */
export const ALERT_WEBHOOK_URL_ENV = "ALERT_WEBHOOK_URL"
export const ALERT_WEBHOOK_TIMEOUT_MS = 4_000
