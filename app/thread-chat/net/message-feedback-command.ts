import { fetchWithAuth } from "@/lib/auth/session-recovery"
import {
  setMessageFeedbackErrorResponseSchema,
  setMessageFeedbackSuccessResponseSchema,
} from "@/lib/thread-chat/contracts/message-feedback"
import type { MessageFeedback, MessageFeedbackSummary } from "../core/types"

type SubmitMessageFeedbackInput = {
  treeId: string
  threadId: string
  messageId: string
  feedback: MessageFeedback | null
}

type SubmitMessageFeedbackDependencies = {
  fetch: typeof fetchWithAuth
}

const defaultDependencies: SubmitMessageFeedbackDependencies = {
  fetch: fetchWithAuth,
}

/** 持久化一条 assistant message 的反馈，并按共享契约校验响应。 */
export async function submitMessageFeedback(
  { treeId, threadId, messageId, feedback }: SubmitMessageFeedbackInput,
  dependencies: SubmitMessageFeedbackDependencies = defaultDependencies
): Promise<MessageFeedbackSummary | null> {
  const res = await dependencies.fetch(
    `/api/branch-trees/${treeId}/messages/${encodeURIComponent(messageId)}/feedback`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, feedback }),
    }
  )
  const responseBody = await res.json().catch(() => null)
  if (!res.ok) {
    const failure =
      setMessageFeedbackErrorResponseSchema.safeParse(responseBody)
    throw new Error(
      failure.success
        ? failure.data.error.message
        : `feedback failed: ${res.status}`
    )
  }
  const success =
    setMessageFeedbackSuccessResponseSchema.safeParse(responseBody)
  if (!success.success) throw new Error("feedback response invalid")
  return success.data.feedback
}
