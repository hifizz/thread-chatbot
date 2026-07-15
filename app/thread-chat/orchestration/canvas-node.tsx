"use client"
/**
 * orchestration/canvas-node —— 画布模式的自定义节点：一个 thread 一张「手稿纸质」卡。
 *
 * 与列模式同一套纸墨视觉语言（复用 .tc 的 CSS 变量 / .anchor-tag）：
 * 深度色左缘 3px + 脚注号徽章 + 衬线标题 + 讨论焦点引文 + 末条消息摘要 + meta 行；
 * 主线卡特殊化为「锚定」tag + 主题副标题。data 全部由 use-canvas-layout 派生成
 * 展示就绪的字段（React.memo，skill 契约：custom node 优先 + memo）。
 *
 * Phase 2 节点内对话（openspec: add-canvas-conversations）：选中节点在卡片下方
 * 展开「外挂面板」CanvasExpand——绝对定位、不参与 dagre 布局（展开零重排，D1）；
 * 消息渲染复用列模式全套（AnchoredMarkdown：MarkdownBody + SmoothText + 锚点
 * 手绘 effect，D2）并挂列模式的划选 DOM 契约（.msg-list[data-list] /
 * .message[data-msg-id] / .bubble[data-role]），document 级划选气泡零改动生效；
 * 发送 / 停止 / 重试经 CanvasActionsContext 直达壳层 chat-controller（D3）；
 * 手势共处（D5）：面板挂 nodrag/nowheel（选字不拖节点、内滚不缩放画布），
 * 双击 stopPropagation 不误触「回列模式」。
 *
 * Handle 仅为边的定位锚点（isConnectable=false，CSS 以 opacity 隐藏——
 * 不能 display:none，会破坏 React Flow 的边坐标计算，skill 契约 #8）。
 */

import React, {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
} from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import type { Message, ThreadTreeState } from "../core/types"
import { AnchoredMarkdown } from "../branching/branchable-chat"

/** 会话动作（send/abort/retry）：壳层用 chat-controller 组装后传给画布（D3，零平行实现） */
export interface CanvasChatActions {
  /** 发一条用户消息并触发流式回复（同会话已有在飞请求时由 controller 忽略） */
  send: (threadId: string, text: string) => void
  /** 中止在飞的流式请求（有正文保留 finish；零正文标「已停止生成」可重试） */
  abort: (threadId: string) => void
  /** 重试某条 assistant 消息（先中止旧流、复位、再起新流） */
  retry: (threadId: string, msgId: string) => void
}

/** 画布节点面板可用的全部动作：chat 三件套 + 画布内聚焦 + 树快照读取 */
export interface CanvasActions extends CanvasChatActions {
  /** 面板内点锚点高亮 / 脚注 = 在画布内聚焦对应分支节点（选中 + setCenter，不回列） */
  focusThread: (threadId: string) => void
  /** 读当前树快照（store 原地可变；面板随 version 重渲，渲染时读到即最新） */
  getState: () => ThreadTreeState
}

/** 由 ThreadCanvas 提供、穿过 React Flow 到自定义节点（面板不感知壳层） */
export const CanvasActionsContext = createContext<CanvasActions | null>(null)

/** 外挂面板宽（与 thread-chat.css 的 .canvas-expand width 同步；比卡宽，setCenter 取中用） */
export const EXPAND_W = 340

/** mini composer 自增高上限（px，与 .cv-composer textarea 的 max-height 同步） */
const COMPOSER_MAX_H = 68
/** 贴底跟滚的释放阈值（px）：距底小于它视为「仍贴底」，流式长高时继续跟 */
const STICK_THRESHOLD = 40

export interface CanvasCardData extends Record<string, unknown> {
  isMain: boolean
  title: string
  /** 主线卡的主题副标题（与列模式主线副标题同源，由壳层传入） */
  subtitle: string | null
  depth: number
  footnote: number | null
  /** 讨论焦点（划选原文，已截断；主线为 null） */
  anchor: string | null
  /** 末条消息摘要（~90 字，已截断） */
  summary: string
  msgCount: number
  artifactCount: number
  /** 深度强调色 / 圆点色（theme.ts 的 accentOf / dotColorOf） */
  accent: string
  dot: string
  /** 完整消息列表（外挂面板用）：store 原地可变，base 随 version 重派生保证最新 */
  messages: Message[]
  /** mini composer 预填（空分支的代拟首问，语义同列模式 composerPrefillFor） */
  prefill: string | null
}

export type CanvasCardNode = Node<CanvasCardData, "threadCard">

/** textarea 自增高（clamp 后转内滚），与气泡输入框同款 */
function autoGrow(ta: HTMLTextAreaElement) {
  ta.style.height = "auto"
  ta.style.height = Math.min(ta.scrollHeight, COMPOSER_MAX_H) + "px"
}

/**
 * 选中节点的外挂对话面板：迷你消息列表（复用列模式渲染与划选契约）+ mini composer。
 * 根元素 nodrag/nowheel（React Flow 类约定）：面板内选字不拖动节点、滚动不缩放画布；
 * onDoubleClick stopPropagation：面板内双击不触发节点双击（回列模式）。
 */
function CanvasExpand({
  threadId,
  data,
}: {
  threadId: string
  data: CanvasCardData
}) {
  const actions = useContext(CanvasActionsContext)
  const listRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  /** 贴底跟滚开关：用户上滑离底即释放（阅读不被打断），回到底部附近自动恢复 */
  const stickRef = useRef(true)

  /* busy 派生同列模式：末条是 assistant 且仍在 pending/streaming */
  const last = data.messages[data.messages.length - 1]
  const busy =
    last?.role === "assistant" &&
    (last.status === "pending" || last.status === "streaming")

  /* 每次渲染后：仍贴底则跟滚——SmoothText 逐帧长高 / 消息增删 / 面板刚展开都被覆盖
     （面板 nowheel，滚轮已留给这个列表；有意不写 deps：跟随一切引发高度变化的重渲） */
  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  /* composer 预填语义同列模式（chat-view）：只在输入框为空时命令式写入，
     光标移到末尾，待用户改写或回车确认；消息一入树 prefill 即失效（壳层派生） */
  useEffect(() => {
    const ta = taRef.current
    if (!ta || !data.prefill || ta.value !== "") return
    ta.value = data.prefill
    autoGrow(ta)
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [threadId, data.prefill])

  const doSend = () => {
    if (busy || !actions) return
    const ta = taRef.current
    if (!ta) return
    const v = ta.value.trim()
    if (!v) return
    ta.value = ""
    ta.style.height = "auto"
    stickRef.current = true // 发送即回到贴底（与列模式 autoScroll 语义一致）
    actions.send(threadId, v)
    ta.focus({ preventScroll: true })
  }

  const state = actions?.getState()

  return (
    <div
      className="canvas-expand nodrag nowheel"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 划选 DOM 契约与列模式完全一致：.msg-list[data-list] > .message[data-msg-id]
          > .bubble[data-role]，气泡的 closest 反查零改动生效 */}
      <div
        className="msg-list mini"
        data-list={threadId}
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
        }}
      >
        {data.messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.role}`}
            data-msg-id={msg.id}
          >
            {msg.role === "user" ? (
              <div className="bubble" data-role="user">
                {msg.quote && <div className="msg-quote">{msg.quote.text}</div>}
                {msg.text}
              </div>
            ) : (
              <>
                <div className="bubble" data-role="assistant">
                  {msg.status === "pending" && !msg.text ? (
                    <span
                      className="typing"
                      role="status"
                      aria-label="正在生成回复"
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <>
                      {/* 与列模式同一渲染件（D2）：Markdown 富文本 + SmoothText 平滑
                          + 锚点高亮/脚注手绘；点高亮 = 画布内聚焦该分支节点 */}
                      {state && actions && (
                        <AnchoredMarkdown
                          state={state}
                          msg={msg}
                          onOpenThread={(id) => actions.focusThread(id)}
                        />
                      )}
                      {msg.status === "streaming" && <span className="caret" />}
                    </>
                  )}
                </div>
                {msg.status === "error" && (
                  <div className="msg-error">
                    {msg.error ?? "生成失败"}
                    <button
                      className="retry"
                      onClick={() => actions?.retry(threadId, msg.id)}
                    >
                      重试
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="cv-composer">
        <textarea
          ref={taRef}
          rows={1}
          placeholder="就地继续这段会话…"
          aria-label="在画布节点里继续对话"
          onInput={(e) => autoGrow(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              // IME 守卫同列模式 composer：组合态 Enter 只做「上屏」不发送；
              // isComposing 覆盖 Chrome/Firefox，keyCode 229 兜底 Safari
              const ne = e.nativeEvent
              if (ne.isComposing || ne.keyCode === 229) return
              e.preventDefault()
              doSend()
            }
          }}
        />
        {busy ? (
          <button
            className="cv-send stop"
            title="停止生成（已收到的内容会保留）"
            onClick={() => actions?.abort(threadId)}
          >
            停止
          </button>
        ) : (
          <button className="cv-send" onClick={doSend}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}

export const CanvasCard = memo(function CanvasCard({
  id,
  data,
  selected,
}: NodeProps<CanvasCardNode>) {
  return (
    <div
      className={`canvas-card${selected ? "expanded" : ""}`}
      style={{ "--accent": data.accent } as React.CSSProperties}
      title={selected ? undefined : "单击：就地展开对话 · 双击：回到列模式打开"}
    >
      {/* LR 横向树：入边锚在左缘、出边锚在右缘（与 dagre rankdir:LR 对应） */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="chead">
        {data.isMain ? (
          <span className="anchor-tag">锚定</span>
        ) : (
          data.footnote !== null && <span className="fn">{data.footnote}</span>
        )}
        <span className="ttl">{data.title}</span>
      </div>
      {data.subtitle && <div className="sub">{data.subtitle}</div>}
      {data.anchor && <div className="anch">「{data.anchor}」</div>}
      {/* 展开时摘要收起（面板已呈现完整末条，避免重复）；dagre 估高不感知选中态，
          故这只改本卡内部高度、不改布局输入——零重排（D1） */}
      {!selected && data.summary && <div className="sum">{data.summary}</div>}
      <div className="meta">
        <span>{data.msgCount} 条消息</span>
        {data.artifactCount > 0 && (
          <span className="am">
            <span className="dot" style={{ background: data.dot }} />
            {data.artifactCount} Artifact
          </span>
        )}
      </div>
      {selected && <CanvasExpand threadId={id} data={data} />}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})
