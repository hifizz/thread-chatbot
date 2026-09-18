// Beta 隐私选择与数据请求的稳定协议；用途发生实质变化时递增版本。
export const CONSENT_POLICY_VERSION = "beta-privacy-v1"
export const CONSENT_COOKIE_NAME = "tc_consent"
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60
export const CONSENT_COOKIE_PATH = "/"
export const CONSENT_API_PATH = "/api/privacy/consent"
export const DATA_REQUEST_API_PATH = "/api/privacy/requests"
export const PRIVACY_REQUEST_BODY_LIMIT_BYTES = 512
export const PRIVACY_EVENT_NAME_MAX_LENGTH = 80
export const PRIVACY_EVENT_PROPERTY_MAX_LENGTH = 200
export const CONSENT_BROADCAST_CHANNEL = "threadchat-consent-v1"
// 服务端事实事件命名空间：客户端不允许伪造成功/账务事实，只允许显式交互事件。
export const PRIVACY_SERVER_FACT_EVENT_PREFIXES = [
  "generation.",
  "branch.",
  "artifact.",
  "core_flow.",
  "credit.",
] as const
