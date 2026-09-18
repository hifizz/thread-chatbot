// Private Beta 的服务端准入策略与安全边界。

export const BETA_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000
export const BETA_INVITE_TOKEN_BYTES = 32
export const BETA_INVITE_AAD = "threadchat-beta-invite-v1"
export const BETA_EMAIL_MAX_ATTEMPTS = 5

export const BETA_ACCESS_ENFORCED =
  process.env.BETA_ACCESS_ENFORCED === "true"

/** 只接受经过价格与渠道验收的精确 modelId；空列表时 Beta 不开放付费模型。 */
export const BETA_MODEL_IDS = new Set(
  (process.env.BETA_MODEL_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
)
