export const OBSERVABILITY_ENVIRONMENTS = {
  development: "development",
  test: "test",
  evaluation: "evaluation",
  staging: "staging",
  production: "production",
} as const

export type ObservabilityEnvironment =
  (typeof OBSERVABILITY_ENVIRONMENTS)[keyof typeof OBSERVABILITY_ENVIRONMENTS]

export const TRACE_NAMES = {
  threadChatGeneration: "thread-chat.generation",
  legacyChatRequest: "legacy-chat.request",
} as const

export const OBSERVATION_NAMES = {
  researchRoute: "research.route",
  researchPlan: "research.plan",
  chatAnswer: "model.chat-answer",
  persistenceCheckpoint: "persistence.checkpoint",
  generationFinalize: "generation.finalize",
  searchProviderAttempt: "search.provider-attempt",
} as const

export const SCORE_NAMES = {
  productFeedback: "product-feedback",
} as const

export const FEEDBACK_SCORE_VALUES = {
  up: "up",
  down: "down",
  cleared: "cleared",
} as const

export const FEEDBACK_SCORE_SOURCE = "thread-chat.product-db"
export const FEEDBACK_SCORE_SCHEMA_VERSION = "feedback-score-v2"

export const OBSERVABILITY_ERROR_CATEGORIES = {
  abort: "abort",
  authentication: "authentication",
  configuration: "configuration",
  initialization: "initialization",
  invalidResponse: "invalid_response",
  protocol: "protocol",
  provider: "provider",
  rateLimit: "rate_limit",
  timeout: "timeout",
  unknown: "unknown",
} as const

export type ObservabilityErrorCategory =
  (typeof OBSERVABILITY_ERROR_CATEGORIES)[keyof typeof OBSERVABILITY_ERROR_CATEGORIES]

export const OBSERVABILITY_ATTRIBUTE_KEYS = [
  "requestId",
  "projectId",
  "threadId",
  "assistantMessageId",
  "generationId",
  "treeId",
  "modelId",
  "pseudonymousUserId",
  "environment",
  "release",
  "promptVersion",
  "searchPolicyVersion",
  "memoryPolicyVersion",
  "toolsetVersion",
  "multimodalParserVersion",
  "entrypoint",
  "experiment",
  "caseId",
  "candidate",
] as const

export type ObservabilityAttributeKey =
  (typeof OBSERVABILITY_ATTRIBUTE_KEYS)[number]

export const DEFAULT_OBSERVABILITY_RELEASE = "local"

export const OBSERVABILITY_POLICY_VERSIONS = {
  prompt: "thread-chat-prompt-v1",
  search: "anysearch-v1",
  memory: "thread-context-v1",
  toolset: "thread-chat-tools-v1",
  multimodalParser: "attachment-parser-v1",
} as const

export const TELEMETRY_REDACTED_VALUE = "[REDACTED]"
