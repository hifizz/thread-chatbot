/**
 * net/prompt —— 把会话树状态编译成发给 /api/chat 的请求体（纯函数，无副作用）。
 *
 * 消息序：
 *   1. collectInherited：沿 lineage 向上继承的上文（映射为 user/assistant），
 *      受 INHERITED_CHAR_BUDGET 字符预算约束（D8，超预算从最旧丢弃并插省略说明）。
 *   2. 当前会话已有消息（排除本次流式占位、error 消息、空正文的 assistant 消息）。
 * 分支的首问不在这里合成：留空开分支时壳层把 kickoffQuestion 预填进 composer、
 * 用户回车确认后作为真实 user 消息进入 store；气泡带问开分支时壳层 fork 后直接
 * chat.send——两条路径的首问都随消息列表自然进入 payload。
 *
 * system 归服务端所有：AI SDK v7 的 streamText 不允许 messages 里出现 system 角色
 * （安全默认值，防客户端注入任意 system 指令）。因此客户端只在请求体上带
 * `threadChat: { anchorText }` 模式标记，结构化风格段与分支焦点段由
 * /api/chat 服务端的 buildThreadChatSystem（lib/chat/thread-chat-prompt.ts）统一构造。
 *
 * 关于类型：这里自定义了轻量的 UIMessageLike，而不 `import type { UIMessage } from "ai"`。
 * 理由——请求体只是一段 JSON，字段校验发生在服务端的 convertToModelMessages；
 * 客户端只需构造出结构匹配的对象即可，自定义最小类型既能保持 demo「零外部 import」
 * 的风格，也避免把 ai 的 UIMessage 泛型（带 metadata/dataParts 等）拖进客户端类型面。
 */

import type { Thread, ThreadTreeState } from "../core/types"
import { kickoffQuestion } from "./prompt-pure"
import { serializeMessageForModel } from "./message-serialization"
import type { ThreadChatGenerationIntent } from "../generation/types"
import type { ThreadChatGenerationIdentity } from "@/lib/thread-chat/contracts/generation-identity"
import {
  compileThreadChatMessages,
  type UIMessageLike,
} from "./message-context"

// kickoff 文案模板定义在叶子模块 prompt-pure.ts（e2e 需 node 直载），这里保持原导入面
export { kickoffQuestion }
export { serializeMessageForModel }

/** 发给 /api/chat 的最小消息形状（结构匹配 ai 的 UIMessage，仅用纯文本 part） */
export type { UIMessageLike } from "./message-context"

/** /api/chat 的 thread-chat 模式请求体 */
export interface ThreadChatRequestBody {
  messages: UIMessageLike[]
  /** 当前 Thread 拥有的模型；服务端仍会按统一注册表严格校验。 */
  modelId: string
  /** 模式标记：服务端据此构造纯文本 system（anchorText 非空时追加分支焦点段） */
  threadChat: ThreadChatGenerationIdentity
}

/**
 * 组装本次请求的完整 body（messages + threadChat 模式标记）。
 * 主线 anchorText 为 null 时也照发 threadChat 字段——有意为之：
 * 让主线同样吃到服务端的结构化风格 system，只是不带分支焦点段。
 * @param excludeMsgId 本次流式回复的占位消息 id（当前 pending/streaming 的空 assistant），需排除
 */
export function buildRequestBody(
  state: ThreadTreeState,
  thread: Thread,
  excludeMsgId: string,
  identity: {
    treeId: string
    userMessageId: string
    generationId: string
    intent: ThreadChatGenerationIntent
  }
): ThreadChatRequestBody {
  const anchor = thread.anchorText?.trim() ? thread.anchorText : null
  const messages = compileThreadChatMessages({
    state,
    threadId: thread.id,
    excludeAssistantMessageId: excludeMsgId,
  })

  return {
    messages,
    modelId: thread.modelId,
    threadChat: {
      anchorText: anchor,
      treeId: identity.treeId,
      threadId: thread.id,
      userMessageId: identity.userMessageId,
      assistantMessageId: excludeMsgId,
      generationId: identity.generationId,
      intent: identity.intent,
    },
  }
}
