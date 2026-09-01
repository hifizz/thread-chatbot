import {
  THREAD_QUOTE_BUDGET_POLICY_VERSION,
  THREAD_QUOTE_DEFAULT_RESERVED_OUTPUT_TOKENS,
} from "@/constants/thread-chat-quote"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import { estimatePromptTokens } from "@/lib/thread-chat/prompt-cache/hash"

export interface PromptInputBudgetPolicy {
  version: typeof THREAD_QUOTE_BUDGET_POLICY_VERSION
  maxInputTokens: number
  reservedOutputTokens: number
}

export interface PromptInputBudgetResult {
  estimatedInputTokens: number
  reservedOutputTokens: number
  maxInputTokens: number
  remainingTokens: number
}

export function resolvePromptInputBudgetPolicy(): PromptInputBudgetPolicy {
  const configured = Number.parseInt(
    process.env.THREAD_CHAT_MAX_INPUT_TOKENS ?? "",
    10
  )
  const maxInputTokens =
    Number.isFinite(configured) && configured >= 8_192
      ? configured
      : 128_000
  return {
    version: THREAD_QUOTE_BUDGET_POLICY_VERSION,
    maxInputTokens,
    reservedOutputTokens: THREAD_QUOTE_DEFAULT_RESERVED_OUTPUT_TOKENS,
  }
}

export function assertPromptInputBudget(input: {
  characters: number
  policy?: PromptInputBudgetPolicy
}): PromptInputBudgetResult {
  const policy = input.policy ?? resolvePromptInputBudgetPolicy()
  const estimatedInputTokens = estimatePromptTokens(input.characters)
  const remainingTokens =
    policy.maxInputTokens -
    policy.reservedOutputTokens -
    estimatedInputTokens
  if (remainingTokens < 0) {
    throw new ConversationApplicationError(
      "INPUT_BUDGET_EXCEEDED",
      "当前历史、引用和附件超过所选模型的安全输入预算，请删减引用或缩短问题后重试"
    )
  }
  return {
    estimatedInputTokens,
    reservedOutputTokens: policy.reservedOutputTokens,
    maxInputTokens: policy.maxInputTokens,
    remainingTokens,
  }
}
