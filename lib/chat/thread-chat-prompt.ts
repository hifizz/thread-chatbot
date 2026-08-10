// thread-chat 模式的服务端 system 提示构造（app/api/chat/route.ts 使用）。
// system 归服务端所有：AI SDK v7 的 streamText 不允许 messages 里出现 system 角色
// （安全默认值，防客户端注入任意 system），所以客户端只发 threadChat 标记与锚点原文，
// 指令模板在这里拼装。

import {
  THREAD_CHAT_BRANCH_PREFIX,
  THREAD_CHAT_BRANCH_SUFFIX,
  THREAD_CHAT_SYSTEM,
} from "@/constants/thread-chat"
import {
  buildThreadChatSearchPolicy,
  type ThreadChatSearchPolicyOptions,
} from "@/lib/chat/thread-chat-search-policy"

/**
 * 构造 thread-chat 模式的 system 提示：
 * 通用结构化风格段 +（anchorText 非空时）分支焦点段（锚点原文作为数据嵌入「」内）。
 */
export function buildThreadChatSystem(
  anchorText?: string | null,
  searchPolicy?: ThreadChatSearchPolicyOptions
): string {
  const anchor = anchorText?.trim()
  const branch = anchor
    ? `${THREAD_CHAT_BRANCH_PREFIX}「${anchor}」。${THREAD_CHAT_BRANCH_SUFFIX}`
    : null
  const policy = searchPolicy
    ? buildThreadChatSearchPolicy(searchPolicy)
    : null

  return [THREAD_CHAT_SYSTEM, branch, policy].filter(Boolean).join("\n\n")
}
