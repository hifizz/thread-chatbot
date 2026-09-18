// 产品分析事件的唯一事实来源：事件名、payload 契约、schema 版本与投递环境。
// 指标字典见 METRIC_DICTIONARY；口径改动必须同步 Admin 展示与发布门禁。

import { OBSERVABILITY_ENVIRONMENTS } from "@/constants/observability"

export const PRODUCT_EVENT_SCHEMA_VERSION = 1 as const

export const PRODUCT_EVENT_NAMES = [
  "generation.started",
  "generation.completed",
  "generation.failed",
  "branch.created",
  "artifact.updated",
  "core_flow.completed",
  "credit.exhausted",
] as const

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number]

export type ProductEventPayloads = {
  "generation.started": { generationId: string; modelId: string }
  "generation.completed": { generationId: string; durationMs: number }
  "generation.failed": { generationId: string; errorCode: string }
  "branch.created": { threadId: string; parentThreadId: string }
  "artifact.updated": { artifactId: string; revisionId: string }
  "core_flow.completed": { projectId: string; threadId: string }
  "credit.exhausted": { generationId: string | null }
}

export const PRODUCT_EVENT_ENVIRONMENTS = [
  OBSERVABILITY_ENVIRONMENTS.development,
  OBSERVABILITY_ENVIRONMENTS.evaluation,
  OBSERVABILITY_ENVIRONMENTS.staging,
  OBSERVABILITY_ENVIRONMENTS.production,
] as const

export type ProductEventEnvironment =
  (typeof PRODUCT_EVENT_ENVIRONMENTS)[number]

/** PostHog 服务端投递配置；缺省不投递也不阻断业务。 */
export const POSTHOG_HOST_DEFAULT = "https://us.i.posthog.com"
export const POSTHOG_CAPTURE_TIMEOUT_MS = 4_000
export const ANALYTICS_CAPTURE_API_PATH = "/api/analytics/capture"
export const ANALYTICS_CAPTURE_BODY_LIMIT_BYTES = 2_048

/**
 * 指标字典：所有聚合只读取自有 DB 的服务事实（必要用途），与 PostHog 同意人群
 * 分开标注。时间段一律 UTC；样本不足或窗口未成熟时不下结论。
 */
export const METRIC_TIMEZONE = "UTC"
export const METRIC_DICTIONARY = {
  serviceDau:
    "桶内至少一次真实受理生成、成功分支或 Artifact 编辑的去重用户；只用必要服务事实",
  firstAnswerRate:
    "注册 cohort 内完成一次有效回答（completed 且非空）的用户比例",
  coreActivation:
    "完成首次回答后创建分支并在分支获得有效回答的用户比例；另统计文档采纳",
  retentionD1D7:
    "注册与激活 cohort 分开；仅在完整观察窗口后判断回访，未满窗口不计流失",
  terminalDistribution:
    "accepted/completed/failed/stopped/superseded/running 分列；进行中不算失败",
  technicalSuccessRate:
    "completed / (completed + failed)；主动停止与 superseded 单独列出",
  successfulTaskCost:
    "当日全部供应商费用（含失败任务成本）/ completed 数量；unknown 标 partial",
  latency:
    "completed 生成的首 Token 与总时长 p50/p95；样本数必须同时展示，按模型切分",
} as const

/** 运营视图里标记为内部测试/机器人并排除的账户来源（逗号分隔邮箱）。 */
export const INTERNAL_TEST_USER_EMAILS_ENV = "INTERNAL_TEST_USER_EMAILS"

export const ADMIN_METRICS_MAX_DAYS = 90
export const ADMIN_METRICS_DEFAULT_DAYS = 14
export const ADMIN_USER_SEARCH_MAX_LIMIT = 50
