import {
  DEFAULT_MODEL_INPUT_TOKEN_LIMIT,
  DEFAULT_MODEL_OUTPUT_TOKEN_RESERVE,
  MAX_THREAD_QUOTE_COMMENT_CHARACTERS,
  MAX_THREAD_QUOTE_ESTIMATED_TOKENS,
  MAX_THREAD_QUOTE_TEXT_CHARACTERS,
  MAX_THREAD_QUOTE_TOTAL_CHARACTERS,
  MAX_THREAD_QUOTES,
  QUOTE_BUDGET_POLICY_VERSION,
} from "@/constants/prompt-cache"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import type { ThreadQuoteDataV1 } from "@/lib/thread-chat/domain/thread-quote"

/** 保守估算：中英文、代码和 JSON 混合输入按约 3 字符/Token。 */
export function estimateInputTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

export interface ModelInputBudget {
  policyVersion: typeof QUOTE_BUDGET_POLICY_VERSION
  inputTokenLimit: number
  outputTokenReserve: number
  quoteTokenLimit: number
}

export function defaultModelInputBudget(
  overrides: Partial<Omit<ModelInputBudget, "policyVersion">> = {}
): ModelInputBudget {
  return {
    policyVersion: QUOTE_BUDGET_POLICY_VERSION,
    inputTokenLimit:
      overrides.inputTokenLimit ?? DEFAULT_MODEL_INPUT_TOKEN_LIMIT,
    outputTokenReserve:
      overrides.outputTokenReserve ?? DEFAULT_MODEL_OUTPUT_TOKEN_RESERVE,
    quoteTokenLimit:
      overrides.quoteTokenLimit ?? MAX_THREAD_QUOTE_ESTIMATED_TOKENS,
  }
}

export function assertQuoteWriteBudget(
  quotes: readonly ThreadQuoteDataV1[]
): void {
  if (quotes.length > MAX_THREAD_QUOTES) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      `每条消息最多引用 ${MAX_THREAD_QUOTES} 段内容`
    )
  }
  let totalCharacters = 0
  for (const quote of quotes) {
    if (quote.text.length > MAX_THREAD_QUOTE_TEXT_CHARACTERS) {
      throw new ConversationApplicationError(
        "VALIDATION_ERROR",
        "单段引用内容过长"
      )
    }
    if (
      quote.comment !== undefined &&
      quote.comment.length > MAX_THREAD_QUOTE_COMMENT_CHARACTERS
    ) {
      throw new ConversationApplicationError(
        "VALIDATION_ERROR",
        "单条引用评论过长"
      )
    }
    totalCharacters += quote.text.length + (quote.comment?.length ?? 0)
  }
  if (totalCharacters > MAX_THREAD_QUOTE_TOTAL_CHARACTERS) {
    throw new ConversationApplicationError(
      "INPUT_BUDGET_EXCEEDED",
      "引用内容总量过大，请删减后重试"
    )
  }
  if (estimateInputTokens("x".repeat(totalCharacters)) > MAX_THREAD_QUOTE_ESTIMATED_TOKENS) {
    throw new ConversationApplicationError(
      "INPUT_BUDGET_EXCEEDED",
      "引用内容预计 Token 超过安全预算，请删减后重试"
    )
  }
}

export function assertCompleteModelInputBudget(input: {
  modelVisibleText: string
  budget?: ModelInputBudget
}): void {
  const budget = input.budget ?? defaultModelInputBudget()
  const estimatedInputTokens = estimateInputTokens(input.modelVisibleText)
  const availableInputTokens = Math.max(
    0,
    budget.inputTokenLimit - budget.outputTokenReserve
  )
  if (estimatedInputTokens > availableInputTokens) {
    throw new ConversationApplicationError(
      "INPUT_BUDGET_EXCEEDED",
      "完整上下文预计超过当前模型输入预算，请删减引用或开启新的对话"
    )
  }
}
