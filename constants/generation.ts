export const GENERATION_STATUSES = [
  "running",
  "stop_requested",
  "completed",
  "stopped",
  "failed",
  "superseded",
] as const

export const ACTIVE_GENERATION_STATUSES = [
  "running",
  "stop_requested",
] as const

export const GENERATION_BILLING_STATUSES = [
  "pending",
  "settled",
  "usage_unavailable",
  "not_billable",
] as const

export const GENERATION_RESULT_VERSION = 1 as const
export const GENERATION_CLIENT_POLL_MS = 2_000
export const GENERATION_HIDDEN_POLL_MS = 10_000
export const GENERATION_CANCEL_POLL_MS = 1_000
export const GENERATION_HEARTBEAT_MS = 10_000
export const GENERATION_MAX_DURATION_MS = 300_000
export const GENERATION_LEASE_GRACE_MS = 30_000
export const GENERATION_LEASE_MS =
  GENERATION_MAX_DURATION_MS + GENERATION_LEASE_GRACE_MS

export const GENERATION_ERRORS = {
  backgroundInterrupted: "后台生成已中断，请重试。",
  emptyResponse: "模型没有返回可展示内容，请重试。",
  persistenceBarrier: "保存对话失败，尚未调用模型，请重试。",
  stopped: "已停止生成。",
  streamFailed: "生成失败，请重试。",
} as const

export const GENERATION_BACKGROUND_LABEL = "正在后台生成，完成后显示"
