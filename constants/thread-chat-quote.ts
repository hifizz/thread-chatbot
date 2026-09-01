export const THREAD_QUOTE_SCHEMA_VERSION = "thread-quote-v1" as const
export const THREAD_QUOTE_MODEL_FORMAT_VERSION =
  "thread-quote-model-v1" as const
export const THREAD_QUOTE_BUDGET_POLICY_VERSION =
  "thread-quote-budget-v1" as const

/** Product-level block count limit. Model-route budgets are checked separately. */
export const THREAD_QUOTE_MAX_COUNT = 50

/** Defensive persistence limits; the prompt compiler applies stricter route budgets. */
export const THREAD_QUOTE_MAX_TEXT_CHARACTERS = 200_000
export const THREAD_QUOTE_MAX_COMMENT_CHARACTERS = 20_000
export const THREAD_QUOTE_MAX_TOTAL_CHARACTERS = 500_000

/** Conservative model-window reservation used before exact/provider token data exists. */
export const THREAD_QUOTE_TOKEN_ESTIMATE_CHARACTERS = 3
export const THREAD_QUOTE_DEFAULT_RESERVED_OUTPUT_TOKENS = 8_192
