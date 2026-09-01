import {
  THREAD_PROMPT_CHARACTERS_PER_TOKEN_ESTIMATE,
  THREAD_PROMPT_DEFAULT_CONTEXT_TOKENS,
  THREAD_PROMPT_DEFAULT_OUTPUT_RESERVE_TOKENS,
  THREAD_PROMPT_INPUT_WINDOW_RATIO,
  THREAD_QUOTE_BUDGET_POLICY_VERSION,
  THREAD_QUOTE_MAX_COMMENT_CHARS,
  THREAD_QUOTE_MAX_COUNT,
  THREAD_QUOTE_MAX_TEXT_CHARS,
  THREAD_QUOTE_MAX_TOTAL_CHARS,
} from "@/constants/thread-chat"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import type { ThreadQuoteDataV1 } from "@/lib/thread-chat/domain/thread-quote"

export type QuoteBudgetSummary = {
  policyVersion: typeof THREAD_QUOTE_BUDGET_POLICY_VERSION
  quoteCount: number
  quoteCharacters: number
  commentCharacters: number
  totalCharacters: number
  estimatedTokens: number
}

export function estimatePromptTokens(characters: number): number {
  if (!Number.isFinite(characters) || characters <= 0) return 0
  return Math.ceil(characters / THREAD_PROMPT_CHARACTERS_PER_TOKEN_ESTIMATE)
}

export function summarizeQuoteBudget(
  quotes: readonly Pick<ThreadQuoteDataV1, "text" | "comment">[]
): QuoteBudgetSummary {
  const quoteCharacters = quotes.reduce(
    (total, quote) => total + quote.text.length,
    0
  )
  const commentCharacters = quotes.reduce(
    (total, quote) => total + (quote.comment?.length ?? 0),
    0
  )
  const totalCharacters = quoteCharacters + commentCharacters
  return {
    policyVersion: THREAD_QUOTE_BUDGET_POLICY_VERSION,
    quoteCount: quotes.length,
    quoteCharacters,
    commentCharacters,
    totalCharacters,
    estimatedTokens: estimatePromptTokens(totalCharacters),
  }
}

export function assertQuoteBudget(
  quotes: readonly Pick<ThreadQuoteDataV1, "text" | "comment">[]
): QuoteBudgetSummary {
  if (quotes.length > THREAD_QUOTE_MAX_COUNT) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      `每条消息最多引用 ${THREAD_QUOTE_MAX_COUNT} 段内容`
    )
  }

  for (const quote of quotes) {
    if (quote.text.length === 0 || quote.text.length > THREAD_QUOTE_MAX_TEXT_CHARS) {
      throw new ConversationApplicationError(
        "VALIDATION_ERROR",
        `单份引用正文必须为 1-${THREAD_QUOTE_MAX_TEXT_CHARS} 个字符`
      )
    }
    if ((quote.comment?.length ?? 0) > THREAD_QUOTE_MAX_COMMENT_CHARS) {
      throw new ConversationApplicationError(
        "VALIDATION_ERROR",
        `单份引用评论不能超过 ${THREAD_QUOTE_MAX_COMMENT_CHARS} 个字符`
      )
    }
  }

  const summary = summarizeQuoteBudget(quotes)
  if (summary.totalCharacters > THREAD_QUOTE_MAX_TOTAL_CHARS) {
    throw new ConversationApplicationError(
      "INPUT_BUDGET_EXCEEDED",
      "引用内容过长，请减少引用数量或缩短引用范围"
    )
  }
  return summary
}

export type PromptWindowBudgetInput = {
  inputCharacters: number
  contextWindowTokens?: number
  outputReserveTokens?: number
}

export type PromptWindowBudget = {
  policyVersion: typeof THREAD_QUOTE_BUDGET_POLICY_VERSION
  inputCharacters: number
  estimatedInputTokens: number
  contextWindowTokens: number
  outputReserveTokens: number
  maximumInputTokens: number
}

export function assertPromptWindowBudget(
  input: PromptWindowBudgetInput
): PromptWindowBudget {
  const contextWindowTokens =
    input.contextWindowTokens ?? THREAD_PROMPT_DEFAULT_CONTEXT_TOKENS
  const outputReserveTokens =
    input.outputReserveTokens ?? THREAD_PROMPT_DEFAULT_OUTPUT_RESERVE_TOKENS
  const maximumInputTokens = Math.max(
    0,
    Math.floor(contextWindowTokens * THREAD_PROMPT_INPUT_WINDOW_RATIO) -
      outputReserveTokens
  )
  const estimatedInputTokens = estimatePromptTokens(input.inputCharacters)
  if (estimatedInputTokens > maximumInputTokens) {
    throw new ConversationApplicationError(
      "INPUT_BUDGET_EXCEEDED",
      "当前对话与引用内容超过所选模型的安全输入预算，请减少引用或另开较短的分支"
    )
  }
  return {
    policyVersion: THREAD_QUOTE_BUDGET_POLICY_VERSION,
    inputCharacters: input.inputCharacters,
    estimatedInputTokens,
    contextWindowTokens,
    outputReserveTokens,
    maximumInputTokens,
  }
}
