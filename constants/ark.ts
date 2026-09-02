/** 火山方舟 Coding Plan 的 OpenAI-compatible 专用端点。 */
export const ARK_CODING_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/coding/v3"

/**
 * 用于分支标题的 Coding Plan 轻量模型。
 *
 * 标题生成只需提炼一轮对话的主题；`doubao-seed-2.0-mini` 在此类短文本任务上
 * 足够，并且比 Lite 的输入、输出单价更低。
 */
export const ARK_BRANCH_TITLE_MODEL = "doubao-seed-2.0-mini"

/**
 * 标题生成的输出 token 安全阀。它只限制一次模型调用的成本，不作为标题字符、
 * 英文单词或前端展示长度的规则。
 */
export const ARK_BRANCH_TITLE_MAX_OUTPUT_TOKENS = 48
