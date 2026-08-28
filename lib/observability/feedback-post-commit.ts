import { after } from "next/server"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import { classifyObservabilityError } from "@/lib/observability/error"
import { mirrorMessageFeedback } from "@/lib/observability/feedback-score"

export type PostCommitScheduler = (task: () => Promise<void>) => void

export function scheduleFeedbackMirrorAfterCommit(
  message: Pick<MessageDTO, "id" | "feedback" | "updatedAt">,
  schedule: PostCommitScheduler = after
): void {
  const task = async () => {
    await mirrorMessageFeedback({
      messageId: message.id,
      feedback: message.feedback,
      updatedAt: message.updatedAt,
    })
  }

  try {
    schedule(task)
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "feedback_score_post_commit_registration_failed",
        errorCategory: classifyObservabilityError(error),
      })
    )
    queueMicrotask(() => void task())
  }
}
