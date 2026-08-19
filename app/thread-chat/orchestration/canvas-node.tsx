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
 * 消息渲染复用列模式全套（AnchoredAssistantBody：Markdown + SmoothText + 锚点
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
import { AnchoredAssistantBody } from "../branching/anchored-assistant-body"
import {
  MarkdownArtifactCard,
  MarkdownArtifactProgressCard,
} from "./markdown-artifact-card"
import { ConversationComposer } from "../chat/conversation-composer"
import { ConversationMessage } from "../chat/conversation-message"
import type { MessageActionViewState } from "../chat/message-action-types"
import type { ThreadMessageActionCommands } from "../net/chat-controller"

/** 会话动作（send/stop/retry）：壳层用 chat-controller 组装后传给画布（D3，零平行实现） */
export interface CanvasChatActions extends ThreadMessageActionCommands {
  /** 发一条用户消息并触发流式回复（同会话已有在飞请求时由 controller 忽略） */
  send: (threadId: string, text: string) => void
  /** 经服务端确认的显式 Stop；普通页面卸载不调用。 */
  stop: (threadId: string) => void
  /** 重试某条 assistant 消息（先中止旧流、复位、再起新流） */
  retry: (threadId: string, msgId: string) => void
}

/** 画布节点面板可用的全部动作：chat 三件套 + 画布内聚焦 + 树快照读取 */
export interface CanvasActions extends CanvasChatActions {
  /** 面板内点锚点高亮 / 脚注 = 在画布内聚焦对应分支节点（选中 + setCenter，不回列） */
  focusThread: (threadId: string) => void
  /** 在全局 Markdown 面板中打开消息流里的交付物。 */
  openArtifact: (artifactId: string) => void
  /** 读当前树快照（store 原地可变；面板随 version 重渲，渲染时读到即最新） */
  getState: () => ThreadTreeState
  /** 根 Thread 切换模型；store 会拒绝所有分支写入。 */
  setThreadModel: (threadId: string, modelId: string) => void
  messageActionState: MessageActionViewState
}

/** 由 ThreadCanvas 提供、穿过 React Flow 到自定义节点（面板不感知壳层） */
export const CanvasActionsContext = createContext<CanvasActions | null>(null)

/** 外挂面板宽（与 thread-chat.css 的 .canvas-expand width 同步；比卡宽，setCenter 取中用） */
export const EXPAND_W = 340

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

  const state = actions?.getState()
  const presentation =
    actions?.messageActionState.presentationByThreadId.get(threadId)

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
        {data.messages.map((msg) => {
          return (
            <ConversationMessage
              key={msg.id}
              threadId={threadId}
              message={msg}
              renderUserFallback={() => null}
              renderAssistantBody={(message) =>
                state && actions ? (
                  <AnchoredAssistantBody
                    state={state}
                    message={message}
                    onOpenThread={(id) => actions.focusThread(id)}
                  />
                ) : null
              }
              renderAfterMessage={(message) => (
                <>
                  {message.markdownGeneration && (
                    <MarkdownArtifactProgressCard
                      progress={message.markdownGeneration}
                      sourceDepth={data.depth}
                      compact
                    />
                  )}
                  {state &&
                    actions &&
                    message.artifactIds?.map((artifactId) => {
                      const artifact = state.artifacts[artifactId]
                      if (!artifact) return null
                      return (
                        <MarkdownArtifactCard
                          key={artifactId}
                          artifact={artifact}
                          sourceDepth={
                            state.threads[artifact.sourceThreadId]?.depth ??
                            null
                          }
                          onOpen={actions.openArtifact}
                          compact
                        />
                      )
                    })}
                </>
              )}
              onRetry={(message) => actions?.retry(threadId, message.id)}
              messageActionState={actions?.messageActionState}
              messageCommands={actions ?? undefined}
              editableUserMessageId={presentation?.latestUserMessageId}
              regeneratableAssistantMessageId={
                presentation?.latestAssistantMessageId
              }
              turnAlternatives={presentation?.alternatives ?? []}
            />
          )
        })}
      </div>
      <ConversationComposer
        variant="canvas"
        threadId={threadId}
        isMain={data.isMain}
        busy={busy}
        prefill={data.prefill}
        modelId={state?.threads[threadId]?.modelId}
        modelSelectorDisabled={!data.isMain || busy}
        modelSelectorDisabledReason={
          !data.isMain ? "branch" : busy ? "busy" : undefined
        }
        onModelChange={
          actions
            ? (modelId) => actions.setThreadModel(threadId, modelId)
            : undefined
        }
        onBeforeSend={() => {
          stickRef.current = true
        }}
        onSend={actions ? (text) => actions.send(threadId, text) : undefined}
        onStop={() => actions?.stop(threadId)}
      />
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
      className="canvas-card" /* 选中态样式由 .react-flow__node.selected 提供；此前的条件类拼接丢空格产出 canvas-cardexpanded 单 token，选中即丢全部卡片样式（codex review P1） */
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
            {data.artifactCount} Markdown
          </span>
        )}
      </div>
      {selected && <CanvasExpand threadId={id} data={data} />}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})
