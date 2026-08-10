// Thread Chat 主动 Web Search 的模式、预算、Provider 参数与灰度开关。

export const WEB_SEARCH_MODES = ["auto", "always", "off"] as const
export type WebSearchMode = (typeof WEB_SEARCH_MODES)[number]

export const DEFAULT_WEB_SEARCH_MODE: WebSearchMode = "auto"
export const AUTO_WEB_SEARCH_TOOL_NAME = "webSearch"
export const AUTO_WEB_SEARCH_PROVIDER = "tavily"
export const AUTO_WEB_SEARCH_OPERATION = "basic_search"

/** Tavily Basic Search 每次最多返回给模型的来源数量。 */
export const AUTO_WEB_SEARCH_MAX_RESULTS = 3
/** 单条搜索快照进入模型上下文的最大字符数。 */
export const AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT = 800
/** Provider 标题与来源 URL 的防御性长度限制。 */
export const AUTO_WEB_SEARCH_TITLE_CHAR_LIMIT = 300
export const AUTO_WEB_SEARCH_URL_CHAR_LIMIT = 4096
/** 防止异常工具参数放大 Provider 请求与日志。 */
export const AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT = 400
/** Provider 网络请求超时；失败后不在工具层自动重试。 */
export const AUTO_WEB_SEARCH_TIMEOUT_MS = 10_000
/** 每个 assistant response 最多实际启动的搜索请求数。 */
export const AUTO_WEB_SEARCH_MAX_CALLS = 2
/** 防模型在同一 step 并行扩散查询；第二次搜索只能在看过第一批证据后发起。 */
export const AUTO_WEB_SEARCH_MAX_CALLS_PER_STEP = 1
/** Thread Chat 正常工具循环的最大 step 数。 */
export const THREAD_CHAT_MAX_STEPS = 5
/**
 * 仅开发/内部测试可通过环境变量放大的搜索上限。它仍是硬上限，避免测试时出现
 * 无边界循环；生产环境永远忽略该变量并保持 AUTO_WEB_SEARCH_MAX_CALLS。
 */
export const AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP = 10
/** 高上限测试为最后一次工具结果预留一个回答 step。 */
export const AUTO_WEB_SEARCH_TEST_MAX_STEPS_CAP =
  AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP + 1
/** 正常运营目标；硬上限仍由 AUTO_WEB_SEARCH_MAX_CALLS 保证。 */
export const AUTO_WEB_SEARCH_TARGET_CALLS = 1

/** Tavily 官方 PAYG 上限和 Basic Search credit 口径（核对于 2026-08-03）。 */
export const TAVILY_BASIC_SEARCH_CREDITS = 1
export const TAVILY_PAYG_USD_PER_CREDIT = 0.008

/**
 * 版本敏感编程主题的一手来源提示。仅在 query 命中时传给 provider；通用搜索不设
 * allowlist，且返回结果仍需经过相同 URL/内容校验。
 */
export const PROGRAMMING_OFFICIAL_DOMAIN_HINTS: readonly {
  pattern: RegExp
  domains: readonly string[]
}[] = [
  { pattern: /\bnext(?:\.js|js)?\b/i, domains: ["nextjs.org"] },
  { pattern: /\breact\b/i, domains: ["react.dev"] },
  { pattern: /\bnode(?:\.js|js)?\b/i, domains: ["nodejs.org"] },
  { pattern: /\btypescript\b/i, domains: ["typescriptlang.org"] },
  { pattern: /\bai sdk\b/i, domains: ["ai-sdk.dev"] },
  { pattern: /\bvercel\b/i, domains: ["vercel.com"] },
  { pattern: /\bpnpm\b/i, domains: ["pnpm.io"] },
  { pattern: /\bdrizzle\b/i, domains: ["orm.drizzle.team"] },
  { pattern: /\bzod\b/i, domains: ["zod.dev"] },
  { pattern: /\beslint\b/i, domains: ["eslint.org"] },
  { pattern: /\bpostgres(?:ql)?\b/i, domains: ["postgresql.org"] },
  { pattern: /\bcloudflare\b/i, domains: ["developers.cloudflare.com"] },
  { pattern: /\bbun\b/i, domains: ["bun.sh"] },
  { pattern: /\bprisma\b/i, domains: ["prisma.io"] },
  { pattern: /\btavily\b/i, domains: ["docs.tavily.com"] },
  { pattern: /\bgithub(?: actions)?\b/i, domains: ["docs.github.com"] },
]

/** 只记录配置名称，不包含任何凭据值。 */
export const AUTO_WEB_SEARCH_ENV_NAMES = {
  apiKey: "SEARCH_API_KEY",
  baseUrl: "SEARCH_BASE_URL",
  enabled: "AUTO_WEB_SEARCH_ENABLED",
  rolloutPercent: "AUTO_WEB_SEARCH_ROLLOUT_PERCENT",
  killSwitch: "AUTO_WEB_SEARCH_KILL_SWITCH",
  internalUserIds: "AUTO_WEB_SEARCH_INTERNAL_USER_IDS",
  testMaxCalls: "AUTO_WEB_SEARCH_TEST_MAX_CALLS",
} as const
