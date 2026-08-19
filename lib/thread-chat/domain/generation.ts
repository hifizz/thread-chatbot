import type { Message, ThreadTreeState } from "@/lib/thread-chat/domain/types"
import type {
  GENERATION_BILLING_STATUSES,
  GENERATION_STATUSES,
} from "@/constants/generation"
import { ACTIVE_GENERATION_STATUSES } from "@/constants/generation"
import type { GenerationResultV1 } from "@/lib/thread-chat/contracts/generation-result"

export type GenerationStatus = (typeof GENERATION_STATUSES)[number]
export type GenerationBillingStatus =
  (typeof GENERATION_BILLING_STATUSES)[number]

export type RecoverableTurnReason =
  "missing_assistant" | "missing_generation" | "interrupted_generation"

export interface RecoverableTurn {
  threadId: string
  userMessageId: string
  assistantMessageId?: string
  reason: RecoverableTurnReason
}

export type { ThreadChatGenerationIntent } from "@/lib/thread-chat/contracts/generation-intent"

export type GenerationTurnIdentity = {
  treeId: string
  threadId: string
  userMessageId: string
  assistantMessageId: string
  generationId: string
}

/** 服务端从严格 schema-v2 树中验证后的最小 turn 快照，用于消息被并发快照删掉时读修复。 */
export type GenerationTurnSnapshot = {
  threadId: string
  assistantMessageIndex: number
  userMessage: Message
  assistantMessage: Message
  userParentMessageId: string | null
  assistantParentMessageId: string
  activatesAssistantMessageId: string
}

export type { GenerationResultV1 } from "@/lib/thread-chat/contracts/generation-result"

export type GenerationUsageMetadata = NonNullable<
  import("@/lib/thread-chat/contracts/generation-result").GenerationResultV1["usage"]
>

export type GenerationSummary = {
  id: string
  treeId: string
  threadId: string
  userMessageId: string
  assistantMessageId: string
  attempt: number
  isCurrent: boolean
  status: GenerationStatus
  updatedAt: string
  result?: GenerationResultV1 | null
}

export interface GenerationForReconcile extends GenerationSummary {
  turnSnapshot: GenerationTurnSnapshot
}

export interface ReconciledThreadChatTree {
  state: ThreadTreeState
  recoverableTurns: RecoverableTurn[]
}

export function isActiveGenerationStatus(
  status: GenerationStatus
): status is "running" | "stop_requested" {
  return ACTIVE_GENERATION_STATUSES.includes(
    status as (typeof ACTIVE_GENERATION_STATUSES)[number]
  )
}
