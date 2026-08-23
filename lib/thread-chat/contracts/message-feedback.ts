import { z } from "zod"

/**
 * 消息反馈值与写入请求的唯一运行时契约。
 * TypeScript 类型必须由 schema 推导，避免领域类型与 API 校验漂移。
 */
export const messageFeedbackSchema = z.enum(["positive", "negative"])

export type MessageFeedback = z.infer<typeof messageFeedbackSchema>
