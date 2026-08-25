import type { UIMessage } from "ai"
import { invariant } from "./domain-error"
import type { MessageId, MessageRunId } from "./ids"

export type MessageRunStatus =
  "queued" | "running" | "completed" | "failed" | "stopped"

export type MessageRun = {
  id: MessageRunId
  assistantMessageId: MessageId
  status: MessageRunStatus
  modelId: string
  eventSequence: number
  checkpointParts: UIMessage["parts"]
  errorCode: string | null
  errorMessage: string | null
  heartbeatAt: Date | null
  stopRequestedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const ALLOWED_TRANSITIONS: Readonly<
  Record<MessageRunStatus, readonly MessageRunStatus[]>
> = {
  queued: ["running", "failed", "stopped"],
  running: ["completed", "failed", "stopped"],
  completed: [],
  failed: [],
  stopped: [],
}

export function isTerminalMessageRunStatus(status: MessageRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped"
}

export function assertMessageRunTransition(
  current: MessageRunStatus,
  next: MessageRunStatus
): void {
  invariant(
    ALLOWED_TRANSITIONS[current].includes(next),
    "message_run_transition_invalid",
    `MessageRun 不允许从 ${current} 转为 ${next}。`
  )
}

export function nextEventSequence(current: number): number {
  invariant(
    Number.isSafeInteger(current) && current >= 0,
    "message_run_transition_invalid",
    "eventSequence 必须是非负安全整数。"
  )
  return current + 1
}
