import type { UIMessage } from "ai"
import { invariant } from "./domain-error"
import type { MessageId, ThreadId } from "./ids"
import type { MessageRun } from "./message-run"

export type MessageRole = "user" | "assistant"

export type Message = {
  id: MessageId
  threadId: ThreadId
  sequence: number
  role: MessageRole
  parts: UIMessage["parts"] | null
  replacesMessageId: MessageId | null
  supersededAt: Date | null
  finalizedAt: Date | null
  createdAt: Date
}

export function selectEffectiveMessages(
  messages: readonly Message[]
): Message[] {
  return messages
    .filter((message) => message.supersededAt === null)
    .toSorted((left, right) => left.sequence - right.sequence)
}

export function assertMessageCanBeReplaced(
  source: Message,
  replacement: Pick<Message, "threadId" | "role" | "replacesMessageId">
): void {
  invariant(
    source.finalizedAt !== null,
    "message_not_finalized",
    "只有 finalized Message 可以被 replacement。"
  )
  invariant(
    source.supersededAt === null,
    "message_superseded",
    "已 superseded Message 不能再次创建 replacement。"
  )
  invariant(
    replacement.replacesMessageId === source.id &&
      replacement.threadId === source.threadId &&
      replacement.role === source.role,
    "message_replacement_invalid",
    "replacement 必须指向同 Thread、同角色的来源 Message。"
  )
}

export function assertMessageForkEligible(
  message: Message,
  run: MessageRun | null
): void {
  invariant(
    message.finalizedAt !== null && message.supersededAt === null,
    "message_not_fork_eligible",
    "Fork source 必须 finalized 且仍在有效时间线。"
  )
  if (message.role === "assistant") {
    invariant(
      run?.status === "completed",
      "message_not_fork_eligible",
      "只有 completed assistant Message 可以作为 Fork source。"
    )
  }
}
