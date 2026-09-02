import type { ConversationMessage } from "@/lib/thread-chat/domain/conversation"
import { currentTimeline } from "@/lib/thread-chat/domain/timeline"

export class ForkContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ForkContextError"
  }
}

/**
 * 创建分支时冻结继承消息 ID。之后来源消息即使 supersede，本数组也不得重算。
 */
export function buildFrozenForkContext({
  parentForkContext,
  parentMessages,
  sourceMessageId,
}: {
  parentForkContext: readonly string[]
  parentMessages: readonly ConversationMessage[]
  sourceMessageId: string
}): string[] {
  const visible = currentTimeline(parentMessages)
  const sourceIndex = visible.findIndex(
    (message) => message.id === sourceMessageId
  )
  if (sourceIndex === -1)
    throw new ForkContextError("来源消息不在父 Thread 的当前时间线中")

  const result = [
    ...parentForkContext,
    ...visible.slice(0, sourceIndex + 1).map((message) => message.id),
  ]
  if (new Set(result).size !== result.length)
    throw new ForkContextError("冻结分支上下文包含重复 Message ID")
  return result
}

export function isValidFrozenForkContext(
  context: readonly string[]
): boolean {
  return (
    context.every((messageId) => messageId.trim().length > 0) &&
    new Set(context).size === context.length
  )
}
