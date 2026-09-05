// thread-chat 模式的服务端 system 提示构造（app/api/chat/route.ts 使用）。
// system 归服务端所有：AI SDK v7 的 streamText 不允许 messages 里出现 system 角色
// （安全默认值，防客户端注入任意 system），所以客户端只发 threadChat 标记与锚点原文，
// 指令模板在这里拼装。

import {
  THREAD_CHAT_MARKDOWN_ARTIFACT_SYSTEM,
  THREAD_CHAT_SYSTEM,
} from "@/constants/thread-chat"

/** Quote 只从所属 User Message Part 进入模型；Thread Anchor 不进入 System。 */
export function buildThreadChatSystem(options?: {
  enableMarkdownArtifact?: boolean
}): string {
  return [
    THREAD_CHAT_SYSTEM,
    options?.enableMarkdownArtifact
      ? THREAD_CHAT_MARKDOWN_ARTIFACT_SYSTEM
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n")
}
