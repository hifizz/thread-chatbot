import type { ModelMessage, SystemModelMessage } from "ai"
import type { PromptCachePolicy } from "@/lib/thread-chat/contracts/prompt-cache"

export interface PromptCacheBoundaries {
  stableInstructionsEnd: true
  stableHistoryMessageIndex: number | null
}

export interface PromptCacheDecoratedPrompt {
  instructions: SystemModelMessage[]
  messages: ModelMessage[]
  breakpointCount: number
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
} as const

function decorateHistoryMessage(message: ModelMessage): ModelMessage {
  if (Array.isArray(message.content) && message.content.length > 0) {
    const lastIndex = message.content.length - 1
    const last = message.content[lastIndex]
    if (last && (last.type === "text" || last.type === "file")) {
      return {
        ...message,
        content: message.content.map((part, index) =>
          index === lastIndex
            ? { ...part, providerOptions: ANTHROPIC_CACHE_CONTROL }
            : part
        ),
      } as ModelMessage
    }
  }
  return {
    ...message,
    providerOptions: ANTHROPIC_CACHE_CONTROL,
  } as ModelMessage
}

/** 只附加 Provider 元数据；文本、角色、消息/Part 顺序均保持不变。 */
export function decoratePromptCache(input: {
  instructions: readonly SystemModelMessage[]
  messages: readonly ModelMessage[]
  boundaries: PromptCacheBoundaries
  policy: PromptCachePolicy
}): PromptCacheDecoratedPrompt {
  if (!input.policy.explicitCacheEnabled) {
    return {
      instructions: [...input.instructions],
      messages: [...input.messages],
      breakpointCount: 0,
    }
  }

  const instructions = input.instructions.map((instruction, index) =>
    index === 0
      ? { ...instruction, providerOptions: ANTHROPIC_CACHE_CONTROL }
      : instruction
  )
  const messages = [...input.messages]
  let breakpointCount = 1
  const index = input.boundaries.stableHistoryMessageIndex
  if (index !== null && index >= 0 && index < messages.length) {
    messages[index] = decorateHistoryMessage(messages[index])
    breakpointCount += 1
  }
  return {
    instructions,
    messages,
    breakpointCount: Math.min(4, breakpointCount),
  }
}
