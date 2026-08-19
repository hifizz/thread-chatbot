import type {
  Artifact,
  Message,
  MessageStatus,
} from "@/app/thread-chat/core/types"
import type {
  GENERATION_BILLING_STATUSES,
  GENERATION_STATUSES,
} from "@/constants/generation"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"

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

export type ThreadChatGenerationIntent =
  | { kind: "persisted-turn" }
  | {
      kind: "regenerate-assistant"
      sourceAssistantMessageId: string
    }
  | { kind: "retry-orphan-user" }
  | {
      kind: "edit-last-user"
      sourceUserMessageId: string
      text: string
    }

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

export type GenerationUsageMetadata = {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  providerMetadata?: unknown
}

/** generation 唯一有权覆盖到 Message / Artifact registry 的字段。 */
export type GenerationResultV1 = {
  version: 1
  generationId: string
  text: string
  status: MessageStatus
  error?: string
  artifactIds: string[]
  artifacts: Record<string, Artifact>
  webResearch?: WebResearchActivity[]
  webResearchTextOffset?: number
  researchRoute?: ResearchRoute
  researchPlan?: ResearchPlan
  usage?: GenerationUsageMetadata
}

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
  state: import("@/app/thread-chat/core/types").ThreadTreeState
  recoverableTurns: RecoverableTurn[]
}

export function isActiveGenerationStatus(
  status: GenerationStatus
): status is "running" | "stop_requested" {
  return status === "running" || status === "stop_requested"
}

export function isTerminalGenerationStatus(
  status: GenerationStatus
): status is "completed" | "stopped" | "failed" | "superseded" {
  return !isActiveGenerationStatus(status)
}
