/**
 * net/prompt —— 把会话树状态编译成发给 /api/chat 的请求体（纯函数，无副作用）。
 *
 * 消息序：
 *   1. collectInherited：沿 lineage 向上继承的上文（映射为 user/assistant）。
 *   2. 分支代拟首问（kickoff）：围绕锚点让模型开讲——只进请求 payload，不进 store，
 *      每次请求都重建，分支的后续轮次同样带上，保证模型视角「有问才有答」。
 *   3. 当前会话已有消息（排除本次流式占位、error 消息、空正文的 assistant 消息）。
 *
 * system 归服务端所有：AI SDK v7 的 streamText 不允许 messages 里出现 system 角色
 * （安全默认值，防客户端注入任意 system 指令）。因此客户端只在请求体上带
 * `threadChat: { anchorText }` 模式标记，纯文本风格段与分支焦点段由
 * /api/chat 服务端的 buildThreadChatSystem（lib/chat/thread-chat-prompt.ts）统一构造。
 *
 * 关于类型：这里自定义了轻量的 UIMessageLike，而不 `import type { UIMessage } from "ai"`。
 * 理由——请求体只是一段 JSON，字段校验发生在服务端的 convertToModelMessages；
 * 客户端只需构造出结构匹配的对象即可，自定义最小类型既能保持 demo「零外部 import」
 * 的风格，也避免把 ai 的 UIMessage 泛型（带 metadata/dataParts 等）拖进客户端类型面。
 */

import { collectInherited } from "../core/selectors"
import type { Thread, ThreadTreeState } from "../core/types"

/** 发给 /api/chat 的最小消息形状（结构匹配 ai 的 UIMessage，仅用纯文本 part） */
export interface UIMessageLike {
  id: string
  role: "user" | "assistant"
  parts: { type: "text"; text: string }[]
}

/** /api/chat 的 thread-chat 模式请求体 */
export interface ThreadChatRequestBody {
  messages: UIMessageLike[]
  /** 模式标记：服务端据此构造纯文本 system（anchorText 非空时追加分支焦点段） */
  threadChat: { anchorText: string | null }
}

/** 分支代拟首问：让模型对着锚点开讲（确定性函数，不落 store） */
function kickoffText(anchorText: string): string {
  return (
    `请围绕我划选的这段话展开讲解：「${anchorText}」。` +
    "先解释它本身的含义，再讲清楚它为什么重要或常见误区/延伸，控制在三段以内。"
  )
}

/** 一条领域消息是否应进入 payload（滤掉 error 与空正文 assistant） */
function includable(
  role: "user" | "assistant",
  text: string,
  status?: string
): boolean {
  if (status === "error") return false
  if (role === "assistant" && text.trim() === "") return false
  return true
}

/**
 * 组装本次请求的完整 body（messages + threadChat 模式标记）。
 * 主线 anchorText 为 null 时也照发 threadChat 字段——有意为之：
 * 让主线同样吃到服务端的纯文本 system（锚点/划选渲染依赖纯文本），只是不带分支焦点段。
 * @param excludeMsgId 本次流式回复的占位消息 id（当前 pending/streaming 的空 assistant），需排除
 */
export function buildRequestBody(
  state: ThreadTreeState,
  thread: Thread,
  excludeMsgId: string
): ThreadChatRequestBody {
  const anchor = thread.anchorText?.trim() ? thread.anchorText : null
  const messages: UIMessageLike[] = []

  // 1. 继承的上文
  for (const m of collectInherited(state, thread)) {
    if (!includable(m.role, m.text, m.status)) continue
    messages.push({
      id: `inh-${m.id}`,
      role: m.role,
      parts: [{ type: "text", text: m.text }],
    })
  }

  // 2. 分支代拟首问（每次都重建，不进 store）
  if (anchor !== null) {
    messages.push({
      id: `kickoff-${thread.id}`,
      role: "user",
      parts: [{ type: "text", text: kickoffText(anchor) }],
    })
  }

  // 3. 当前会话已有消息（排除流式占位 / error / 空 assistant）
  for (const m of thread.messages) {
    if (m.id === excludeMsgId) continue
    if (!includable(m.role, m.text, m.status)) continue
    messages.push({
      id: m.id,
      role: m.role,
      parts: [{ type: "text", text: m.text }],
    })
  }

  return { messages, threadChat: { anchorText: anchor } }
}
