import { z } from "zod"

import { messageFeedbackSchema } from "./message-feedback"

export const canonicalMessageFeedbackSchema = z.object({
  conversationId: z.string().min(1),
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  feedback: messageFeedbackSchema,
  updatedAt: z.string().min(1),
})
export const canonicalMessageFeedbackListSchema = z.object({
  feedback: z.array(canonicalMessageFeedbackSchema),
})
export const setCanonicalMessageFeedbackRequestSchema = z.object({
  threadId: z.string().min(1),
  feedback: messageFeedbackSchema.nullable(),
})
export const setCanonicalMessageFeedbackResponseSchema = z.object({
  feedback: canonicalMessageFeedbackSchema.nullable(),
})
export type CanonicalMessageFeedback = z.infer<
  typeof canonicalMessageFeedbackSchema
>
