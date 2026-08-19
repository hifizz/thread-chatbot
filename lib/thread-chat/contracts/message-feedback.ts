import { z } from "zod"

/**
 * 消息反馈值与写入请求的唯一运行时契约。
 * TypeScript 类型必须由 schema 推导，避免领域类型与 API 校验漂移。
 */
export const messageFeedbackSchema = z.enum(["positive", "negative"])

export const setMessageFeedbackRequestSchema = z.object({
  threadId: z.string().min(1),
  feedback: messageFeedbackSchema.nullable(),
})

export const messageFeedbackSummarySchema = z.object({
  treeId: z.string().min(1),
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  feedback: messageFeedbackSchema,
  updatedAt: z.string().min(1),
})

export const setMessageFeedbackFailureReasonSchema = z.enum([
  "not_found",
  "not_completed",
  "missing_generation",
])

export const messageFeedbackErrorCodeSchema = z.enum([
  "unauthorized",
  "invalid_id",
  "invalid_feedback",
  "not_found",
  "message_not_completed",
  "missing_generation_link",
])

export const setMessageFeedbackSuccessResponseSchema = z.object({
  feedback: messageFeedbackSummarySchema.nullable(),
})

export const setMessageFeedbackErrorResponseSchema = z.object({
  error: z.object({
    code: messageFeedbackErrorCodeSchema,
    message: z.string().min(1),
  }),
})

export type MessageFeedback = z.infer<typeof messageFeedbackSchema>
export type SetMessageFeedbackRequest = z.infer<
  typeof setMessageFeedbackRequestSchema
>
export type MessageFeedbackSummary = z.infer<
  typeof messageFeedbackSummarySchema
>
export type SetMessageFeedbackFailureReason = z.infer<
  typeof setMessageFeedbackFailureReasonSchema
>
export type MessageFeedbackErrorCode = z.infer<
  typeof messageFeedbackErrorCodeSchema
>
export type SetMessageFeedbackSuccessResponse = z.infer<
  typeof setMessageFeedbackSuccessResponseSchema
>
export type SetMessageFeedbackResult =
  | { ok: true; feedback: MessageFeedbackSummary | null }
  | { ok: false; reason: SetMessageFeedbackFailureReason }

type MessageFeedbackHttpError = {
  status: number
  error: {
    code: MessageFeedbackErrorCode
    message: string
  }
}

/** 路由阶段与仓储失败原因到公开 HTTP 错误的唯一映射。 */
export const MESSAGE_FEEDBACK_HTTP_ERRORS = {
  unauthorized: {
    status: 401,
    error: { code: "unauthorized", message: "请先登录" },
  },
  invalid_id: {
    status: 400,
    error: { code: "invalid_id", message: "消息身份无效" },
  },
  invalid_feedback: {
    status: 400,
    error: {
      code: "invalid_feedback",
      message: "threadId 与 feedback 必须有效",
    },
  },
  not_found: {
    status: 404,
    error: { code: "not_found", message: "消息不存在" },
  },
  not_completed: {
    status: 409,
    error: {
      code: "message_not_completed",
      message: "只有已完成的 AI 回复可以评价",
    },
  },
  missing_generation: {
    status: 409,
    error: {
      code: "missing_generation_link",
      message: "已完成回复缺少生成记录",
    },
  },
} as const satisfies Record<
  | "unauthorized"
  | "invalid_id"
  | "invalid_feedback"
  | SetMessageFeedbackFailureReason,
  MessageFeedbackHttpError
>
