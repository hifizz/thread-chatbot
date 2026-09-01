import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"

export interface QuoteSourceMessageState {
  projectId: string
  threadId: string
  role: "user" | "assistant"
  status: "generating" | "completed" | "stopped" | "failed"
  supersededAt: Date | string | null
}

export function assertCurrentThreadCompletedAssistant(input: {
  source: QuoteSourceMessageState | null | undefined
  destinationProjectId: string
  destinationThreadId: string
  errorMessage?: string
}): asserts input is {
  source: QuoteSourceMessageState
  destinationProjectId: string
  destinationThreadId: string
  errorMessage?: string
} {
  const source = input.source
  if (
    !source ||
    source.projectId !== input.destinationProjectId ||
    source.threadId !== input.destinationThreadId ||
    source.role !== "assistant" ||
    source.status !== "completed" ||
    source.supersededAt !== null
  ) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      input.errorMessage ?? "只能引用当前 Thread 中已完成的 AI 回复"
    )
  }
}
