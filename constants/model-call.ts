// 服务端模型调用日志的用途标识；用于把同一请求内的路由、计划与正式回答区分开。
export const MODEL_CALL_PURPOSE = {
  attachmentInsights: "attachment-insights",
  threadTitle: "thread-title",
  chatAnswer: "chat-answer",
  embeddingBatch: "embedding-batch",
  embeddingQuery: "embedding-query",
  researchPlan: "research-plan",
  researchRoute: "research-route",
  evaluationJudge: "evaluation-judge",
} as const

export type ModelCallPurpose =
  (typeof MODEL_CALL_PURPOSE)[keyof typeof MODEL_CALL_PURPOSE]
