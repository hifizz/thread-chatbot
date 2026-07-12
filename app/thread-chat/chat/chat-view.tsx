"use client"
/**
 * chat/chat-view —— 单会话视图：消息列表 + composer + who 标签。
 *
 * 这一层不知道「树 / 列 / 分支」的存在：锚点高亮、脚注、artifact 卡片等
 * 分支能力全部通过 renderAssistantBody / renderAfterMessage 两个渲染插槽注入，
 * 列头 / focus banner / 继承上文则作为 header / banner ReactNode 传入。
 *
 * .lane 是纯展示的阅读通道包装（max --lane-max、列内居中）：消息流与 composer
 * 的内容收敛在通道里，纸面 / padding / 边框仍随列通栏；本层不感知列宽。
 */

import React, { useEffect, useRef } from "react"
import { MessageScroller } from "@shadcn/react/message-scroller"
import type { Message } from "../core/types"

/** 把 \n 转成 <br/>（assistant 正文按段落渲染时的行内换行） */
export function withBreaks(s: string, keyBase: string): React.ReactNode[] {
  const lines = s.split("\n")
  const out: React.ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyBase}-br${i}`} />)
    if (line) out.push(line)
  })
  return out
}

/** 默认的 assistant 正文渲染：按空行分段（无任何分支装饰） */
function defaultAssistantBody(msg: Message): React.ReactNode {
  return msg.text
    .split("\n\n")
    .map((p, i) => <p key={i}>{withBreaks(p, `p${i}`)}</p>)
}

export interface ChatViewProps {
  /** 会话 id：写到 .msg-list 的 data-list 上（划选气泡靠它反查消息） */
  threadId: string
  messages: Message[]
  isMain?: boolean
  /** 列头区（面包屑 / 标题行），由上层（branching）组装 */
  header?: React.ReactNode
  /** 列头之下、消息列表之上的横幅区（focus banner / 继承的上文） */
  banner?: React.ReactNode
  /** 消息列表顶部的插卡（主线的 hint 提示） */
  intro?: React.ReactNode
  /** 注入 assistant 正文渲染（锚点高亮 + 脚注上标） */
  renderAssistantBody?: (msg: Message) => React.ReactNode
  /** 注入 assistant 消息气泡之后的附加内容（artifact 卡片） */
  renderAfterMessage?: (msg: Message) => React.ReactNode
  /** 流式生成中：发送键变「停止」（textarea 仍可输入，Enter 提交被拦） */
  busy?: boolean
  /** 错误消息下的「重试」按钮回调 */
  onRetry?: (msg: Message) => void
  /** busy 时点「停止」的回调（中止本会话在飞的流式请求） */
  onStop?: () => void
  /** composer 预填文案（新开分支的代拟首问）：仅在输入框为空时写入，待用户改写或回车确认 */
  composerPrefill?: string
  onSend: (text: string) => void
}

export function ChatView({
  threadId,
  messages,
  isMain = false,
  header,
  banner,
  intro,
  renderAssistantBody,
  renderAfterMessage,
  busy = false,
  onRetry,
  onStop,
  composerPrefill,
  onSend,
}: ChatViewProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const autoGrow = (ta: HTMLTextAreaElement) => {
    ta.style.height = "auto"
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px"
  }

  const doSend = () => {
    if (busy) return
    const ta = taRef.current
    if (!ta) return
    const v = ta.value.trim()
    if (!v) return
    ta.value = ""
    ta.style.height = "auto"
    onSend(v)
    ta.focus()
    // 发送后不再手动滚——MessageScroller.Provider 的 autoScroll 接管贴底
  }

  // composer 预填：新开分支时把代拟首问写进输入框并聚焦（光标移到末尾），待用户回车确认。
  // textarea 是 uncontrolled 且列内 ⇄ 切换会话不一定重挂载，故不用 defaultValue，
  // 用 effect 命令式写入；只在输入框为空时写，避免覆盖用户已敲的内容。
  useEffect(() => {
    const ta = taRef.current
    if (!ta || !composerPrefill || ta.value !== "") return
    ta.value = composerPrefill
    autoGrow(ta)
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [threadId, composerPrefill])

  const renderMessage = (msg: Message) => (
    <div key={msg.id} className={`message ${msg.role}`} data-msg-id={msg.id}>
      <div className="who">{msg.role === "user" ? "你" : "AI"}</div>
      {msg.role === "user" ? (
        <div className="bubble" data-role="user">
          {msg.text}
        </div>
      ) : (
        <>
          <div className="bubble" data-role="assistant">
            {msg.status === "pending" && !msg.text ? (
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <>
                {(renderAssistantBody ?? defaultAssistantBody)(msg)}
                {msg.status === "streaming" && <span className="caret" />}
              </>
            )}
          </div>
          {msg.status === "error" && (
            <div className="msg-error">
              {msg.error ?? "生成失败"}
              <button className="retry" onClick={() => onRetry?.(msg)}>
                重试
              </button>
            </div>
          )}
          {renderAfterMessage?.(msg)}
        </>
      )}
    </div>
  )

  return (
    <>
      {header}
      {banner}
      {/* 滚动：交给 headless MessageScroller 接管「流式贴底 / 上滑释放 / 滚到底按钮」，
          见 §5 注释（下方 Provider）。.msg-list + data-list 必须保留——划选气泡靠
          .closest(".msg-list") + data-list 反查会话。 */}
      <MessageScroller.Provider autoScroll defaultScrollPosition="end">
        <MessageScroller.Root className="msg-scroll-root">
          <MessageScroller.Viewport className="msg-list" data-list={threadId}>
            <MessageScroller.Content>
              <div className="lane">
                {intro}
                {messages.map((msg) => (
                  <MessageScroller.Item key={msg.id} messageId={msg.id}>
                    {renderMessage(msg)}
                  </MessageScroller.Item>
                ))}
              </div>
            </MessageScroller.Content>
          </MessageScroller.Viewport>
          <MessageScroller.Button direction="end" className="scroll-end-btn">
            ↓
          </MessageScroller.Button>
        </MessageScroller.Root>
      </MessageScroller.Provider>
      <div className={`composer ${isMain ? "" : "branch"}`}>
        <div className="lane">
          <div className="box">
            <textarea
              rows={1}
              placeholder={isMain ? "继续在主线提问…" : "在这个分支里追问…"}
              ref={taRef}
              onInput={(e) => autoGrow(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  doSend()
                }
              }}
            />
            {busy ? (
              <button
                className="send stop"
                title="停止生成（已收到的内容会保留）"
                onClick={onStop}
              >
                停止
              </button>
            ) : (
              <button className="send" onClick={doSend}>
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
