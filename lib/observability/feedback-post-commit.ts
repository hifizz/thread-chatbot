import { after } from "next/server"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import { classifyObservabilityError } from "@/lib/observability/error"
import { drainFeedbackScoreOutbox } from "@/lib/observability/feedback-outbox"

export type PostCommitScheduler = (task: () => Promise<void>) => void

export function scheduleFeedbackMirrorAfterCommit(
  message: Pick<MessageDTO, "id">,
  schedule: PostCommitScheduler = after
): void {
  const task = async () => {
    try {
      await drainFeedbackScoreOutbox({ messageId: message.id, limit: 1 })
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "feedback_score_outbox_drain_failed",
          errorCategory: classifyObservabilityError(error),
        })
      )
    }
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
