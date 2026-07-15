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

import { INHERITED_CHAR_BUDGET } from "@/constants/thread-chat"
import { collectInherited } from "../core/selectors"
import type { Thread, ThreadTreeState } from "../core/types"
import {
  applyInheritedBudget,
  kickoffQuestion,
  omittedNoticeText,
} from "./prompt-pure"

// kickoff 文案模板定义在叶子模块 prompt-pure.ts（e2e 需 node 直载），这里保持原导入面
export { kickoffQuestion }

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
 * 让主线同样吃到服务端的结构化风格 system，只是不带分支焦点段。
 * @param excludeMsgId 本次流式回复的占位消息 id（当前 pending/streaming 的空 assistant），需排除
 */
export function buildRequestBody(
  state: ThreadTreeState,
  thread: Thread,
  excludeMsgId: string
): ThreadChatRequestBody {
  const anchor = thread.anchorText?.trim() ? thread.anchorText : null
  const messages: UIMessageLike[] = []

  // 1. 继承的上文（D8：字符总预算约束——超预算从最旧丢弃、保底 1 条，
  //    发生丢弃时在继承段最前插入一条省略说明；当前会话消息不参与截断）
  const inherited: UIMessageLike[] = []
  for (const m of collectInherited(state, thread)) {
    if (!includable(m.role, m.text, m.status)) continue
    // 继承段同样做 quote-aware 序列化（codex review P2）：父分支的带引用裸问题
    // （如「这是什么意思？」）被更深分支继承时，若丢掉 quote 前缀，「就近指代」
    // 歧义会在继承段原样复活——与当前会话消息用同一条拼接规则
    const text = m.quote?.text
      ? `就我划选的这段话：「${m.quote.text}」——${m.text}`
      : m.text
    inherited.push({
      id: `inh-${m.id}`,
      role: m.role,
      parts: [{ type: "text", text }],
    })
  }
  const { kept, omitted } = applyInheritedBudget(
    inherited,
    (m) => m.parts[0].text,
    INHERITED_CHAR_BUDGET
  )
  if (omitted > 0) {
    messages.push({
      id: "inh-omitted",
      role: "user",
      parts: [{ type: "text", text: omittedNoticeText(omitted) }],
    })
  }
  messages.push(...kept)

  // 2. 当前会话已有消息（排除流式占位 / error / 空 assistant）。
  //    grounding 由消息级 quote 字段驱动（方向 C，用户定稿）：带 quote 的消息在
  //    发送线上拼「就我划选的这段话」前缀——裸问题「这是什么意思？」紧跟长上文时，
  //    模型会按就近原则把指代解析到上一条消息结尾（实测复现），前缀让指代确定落到
  //    划选原文。绑定关系是数据（msg.quote）而非代码规则；UI 渲染引用条、store/DB
  //    存原话与 quote 字段，拼接措辞可演进而数据不变。
  for (const m of thread.messages) {
    if (m.id === excludeMsgId) continue
    if (!includable(m.role, m.text, m.status)) continue
    const text = m.quote?.text
      ? `就我划选的这段话：「${m.quote.text}」——${m.text}`
      : m.text
    messages.push({
      id: m.id,
      role: m.role,
      parts: [{ type: "text", text }],
    })
  }

  return { messages, threadChat: { anchorText: anchor } }
}
