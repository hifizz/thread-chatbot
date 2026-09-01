/**
 * Before any paid router/plan/answer call, reserve room for the largest runtime
 * control block and Provider-visible Tool Profile. The exact Prompt Compiler
 * budget still runs after route selection; this conservative guard protects cost.
 */
export const THREAD_PROMPT_PREFLIGHT_DYNAMIC_RESERVE_CHARACTERS = 40_000

/** Fake/live probe schema and evaluator versions. */
export const THREAD_PROMPT_CACHE_PROBE_SCHEMA_VERSION =
  "thread-prompt-cache-probe-v1" as const
export const THREAD_PROMPT_CACHE_COST_POLICY_VERSION =
  "thread-prompt-cache-cost-v1" as const
