// 可观测与评测相关的共享命名：这些名字会同时出现在代码与 Langfuse 看板/查询里，
// 一旦上报就成为数据的一部分，改名会割裂历史数据，务必集中定义、谨慎变更。

/** chat 主链路的 trace/根观测名（Langfuse trace 列表按它筛选） */
export const CHAT_TRACE_NAME = "chat-turn"

/** 各 LLM 调用点的 functionId（遥测分组标识） */
export const TELEMETRY_FUNCTION_IDS = {
  chat: "chat",
  attachmentInsights: "attachment-insights",
  ragEmbedTexts: "rag-embed-texts",
  ragEmbedQuery: "rag-embed-query",
  evalChat: "eval-chat",
} as const

/** 用户反馈（点赞/点踩）score 名，BOOLEAN：1=赞 0=踩 */
export const USER_FEEDBACK_SCORE_NAME = "user-feedback"

/** trace 上区分普通对话 / 深度研究的 tag */
export const TRACE_TAGS = {
  chat: "chat",
  deepResearch: "deep-research",
} as const
